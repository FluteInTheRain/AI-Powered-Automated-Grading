# Runbook

For the person running the teacher app (`app-worker/`, the Python grading Worker in `worker/`, the sandbox in
`sandbox-worker/`). Setup and API details are in [`app-worker/README.md`](../app-worker/README.md). Commands that
start with `npx wrangler` run from `app-worker/` unless noted. Checks below only read. Anything that writes says so.

## 1. Backup and restore

### What is stored where

| Data | Where | In a D1 backup? |
|---|---|---|
| Exams, attempts, code, scores, appeals, canary runs | D1 `teacher-app` | Yes |
| Full LLM prompts and raw replies per graded submission | R2 `teacher-app-audit`, key `audit/<submission_id>.json` | No |
| Attempt clock and one-submit lock | Durable Object `AttemptDO` | No |
| Grading metrics | Analytics Engine `grading_events` | No |
| Code a student is typing | The student's browser (`localStorage`) | No |

### Take a backup

```bash
scripts/d1_backup.sh
```

It runs `wrangler d1 export teacher-app --remote` into `backups/` with a UTC timestamp in the name, prints the size and
the sha256, and refuses to run if `backups/` is not gitignored. Exporting reads the database and changes nothing.

The export contains student names and their answers. Never commit it, never upload it to a public place, and never keep
it as a GitHub Actions artifact. This repository may be public. Keep it on an encrypted disk, and delete old copies.

### Verify a backup

```bash
python3 scripts/d1_restore_drill.py backups/teacher-app-<timestamp>.sql
```

The drill loads the file into a throw away local sqlite database, never into Cloudflare. It checks that every table
the migrations create exists, prints the row count per table, checks that the append-only triggers on
`score_revisions` and `submissions` exist and (when the table has rows) block `UPDATE` and `DELETE`, and runs a foreign
key check. It prints PASS or FAIL per check and exits 1 on any failure. It never prints row contents. Run it on every backup before you rely on it.

Drill run on 2026-11-28 against a real export: 11 tables present, all four triggers present and blocking, no foreign key
violations.

### D1 Time Travel

D1 keeps a history of the database and can rewind it to any minute inside the retention window, with no setup.

- Retention: 7 days on the Workers Free plan, 30 days on Workers Paid. Checked on 2026-11-28 against
  <https://developers.cloudflare.com/d1/reference/time-travel/>.
- See where the database is now (read only): `npx wrangler d1 time-travel info teacher-app`. The output has a bookmark.
- See the bookmark for an earlier time (read only):
  `npx wrangler d1 time-travel info teacher-app --timestamp="2026-11-28T09:00:00+00:00"`.
- Restore to a bookmark or a Unix timestamp:
  `npx wrangler d1 time-travel restore teacher-app --bookmark=<bookmark>` or `--timestamp=<unix seconds>`.

A restore is destructive. It overwrites the live database in place, cancels in-flight queries, and everything written
after the restore point is gone. The restore output prints the previous bookmark; restoring to that bookmark undoes the
restore. Write it down before doing anything else.

Anything older than the window can only come from your own exports. Take one before every risky change, and at least
weekly while exams are running.

### Steps for a restore

1. Stop the damage first. If the cause is a bad deploy, roll it back (section 2) before restoring, or the bad code will write again.
2. Take an export of the current state: `scripts/d1_backup.sh`. Even a damaged database is evidence.
3. Find the restore point: `time-travel info` with a `--timestamp` just before the problem started. Note the bookmark.
4. Decide with the owner. Everything after that moment is lost.
5. Restore: `npx wrangler d1 time-travel restore teacher-app --bookmark=<bookmark>`. Record the "previous bookmark"
   printed in the output.
6. Verify: `npx wrangler d1 execute teacher-app --remote --command "SELECT count(*) FROM score_revisions"` and the same
   for `submissions`, `appeals`, `grading_jobs`. Compare with the counts you expect. Bookmarks can move on their own
   without any write, so counts are the real check.
7. If it was the wrong point, restore to the previous bookmark from step 5.
8. Handle the loss described next.

### What a restore does not bring back, and what it breaks

- **R2 audit logs are not rewound.** After a restore, `audit/<submission_id>.json` files can exist for submissions that
  D1 no longer has. They are harmless, and they may be the only record of how those submissions were graded. Do not
  delete them.
- **Appeals.** An appeal shows the teacher the AI trail from R2 and the score history from D1. After a restore, appeals
  filed after the restore point are gone from D1, and so are teacher decisions and adjusted scores made after it.
  Ask affected students to file again with the same receipt code, and redo the decisions. If a receipt code no longer
  resolves, the attempt was lost too.
- **In progress attempts live partly in a Durable Object.** The clock and the submit lock are not in D1 and are not
  rewound. An attempt that started after the restore point no longer exists in D1, so its submit fails even though its
  timer still runs. The student has to start again under a new attempt. An attempt that existed before the restore
  point keeps its old clock, which is correct. A submit lock left by a crashed request expires by itself after 30 s.
- **Queue messages.** Jobs already queued for submissions that the restore removed will fail and end as `failed`.
  Leave them; each stops after three deliveries.
- **Student drafts** are in each browser and are untouched.
- Analytics Engine metrics are not rewound, so the developer page can show grading events that D1 no longer has.

## 2. Incident playbooks

Each one is Symptom, Check, Action. Start with `npx wrangler tail teacher-app` (live logs; reads only) when the cause
is unclear.

### Grading is stuck or the queue is backed up

- **Symptom.** Students see "queued" or "grading" for minutes. A question shows `stuck`. A teacher reports that no
  scores arrive.
- **Check.**
  - Jobs by status (read only):
    `npx wrangler d1 execute teacher-app --remote --command "SELECT status, count(*) FROM grading_jobs GROUP BY status"`.
  - Oldest waiting job:
    `... --command "SELECT submission_id, status, attempts, error, updated_at FROM grading_jobs WHERE status IN ('queued','grading') ORDER BY updated_at LIMIT 10"`.
  - Queue `grading-jobs` backlog in the Cloudflare dashboard (Queues).
  - The developer page (`/teacher/admin`) for the grading health table.
- **Action.** The app marks a job `stuck` after 120 s and the student gets a "Chấm lại" button (retry). Delivery is at
  least once and a finished job is a no-op, so retrying is safe. There is no dead letter queue by design: a job that
  fails three deliveries becomes `failed` in D1 with a fixed message, and that row is the dead letter. List them with
  `... WHERE status = 'failed'`. Read the `error` column, fix the cause (the next playbooks), then have students press
  retry. If the whole queue is blocked because the grader is down, fix the grader first; retries after that drain it.
  Do not purge the queue: that drops jobs and leaves submissions without scores.

### The Python grading Worker is failing

- **Symptom.** Jobs end `failed`, the student sees the fixed message "Grading service error, please try again.", the teacher app returns 502
  on grader calls, the canary shows `error`.
- **Check.**
  - `curl -i https://teacher-app.khangnguyen.workers.dev/health` tells you the teacher app is up; it does not test the grader.
  - `npx wrangler tail grading` while a job runs.
  - `curl -i -X POST https://grading.khangnguyen.workers.dev/api/internal/grade` should answer 401. A 401 means the
    Worker is up and the token gate works.
  - `INTERNAL_TOKEN` must be the same secret on both Workers. A token mismatch looks like a grader outage.
  - The sandbox Worker `grading-sandbox` has no public URL; check it in the dashboard under Workers.
- **Action.** A bad `grading` deploy: roll it back (section 2, bad deploy, with `--name grading`). A token mismatch: set
  the same value on both (`wrangler secret put INTERNAL_TOKEN` in `app-worker/` and in `worker/` through `uv run pywrangler`).
  This writes a secret on the live account, so do it deliberately. A sandbox failure: redeploy
  `grading-sandbox` first, then `grading`. The order matters because `grading` binds to the sandbox.
  After it is healthy, students retry their stuck questions.

### Workers AI quota is exhausted

- **Symptom.** Correctness still scores (it runs in the sandbox) but rubric checks fail, jobs end `failed` with the LLM
  error, the grading health table fills with errors starting at the same hour.
- **Check.** Free plan allowance is 10,000 neurons per day, resetting at 00:00 UTC (checked 2026-11-28 at
  <https://developers.cloudflare.com/workers-ai/platform/pricing/>). Look at Workers AI usage in the dashboard, and at the
  AI Gateway `teacher-app-gateway` logs. A busy exam day, or the daily canary plus many submissions, can use it up.
- **Action.** Wait for the reset, then have students retry. Or move to Workers Paid, which bills above the free
  allowance. Do not switch grading to a different model in an emergency, because the scores would stop being comparable with
  the canary baseline. Tell teachers that scores will arrive after 00:00 UTC.

### D1 limits are hit

- **Symptom.** Errors about a daily limit, or "too many queries", on many routes at once.
- **Check.** Free plan limits (checked 2026-11-28 at <https://developers.cloudflare.com/d1/platform/pricing/> and
  `.../d1/platform/limits/`): 5 million rows read and 100,000 rows written per day, reset at 00:00 UTC; 500 MB per
  database; 50 queries per Worker invocation. When the daily limit is exceeded, queries fail until the reset. D1 usage per
  day is in the dashboard under D1. A missing index or a loop that reads every row is the usual cause of the read limit.
- **Action.** Wait for the reset, or move to Workers Paid, which removes the daily caps. Take an export when D1 comes
  back. Find the route that reads too many rows (`wrangler tail`) before the next exam. Teacher results are built
  from one query on purpose, because of the 50 query cap.

### Cloudflare Access lockout or misconfiguration

- **Symptom.** The teacher cannot sign in, loops on the login, or `/teacher` loads without a login.
- **Check.**
  - `curl -i https://teacher-app.khangnguyen.workers.dev/api/teacher/me` should answer 302 to the Access login (or 401 `Not signed in`
    when a JWT is missing or invalid). A 200 without a login means the application is not protecting the path.
  - In Zero Trust, the application needs three destinations: `/api/teacher/*`, `/teacher/*` and the exact `/teacher`.
    Student paths `/exam/*` and `/api/exam/*` stay public.
  - `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc` must match the application. A changed AUD tag after
    recreating the application makes every teacher request a 401.
  - Preview URLs must stay off; they bypass Access.
- **Action.** Fix the policy or the destinations in the Zero Trust dashboard (the policy allows one email address; check
  that address). If the AUD changed, put the new value in `wrangler.jsonc` and deploy. Do not turn off Access or set
  `DEV_AUTH_BYPASS` to get around a lockout; either one opens every teacher route. If the owner is locked out of Zero Trust
  itself, recover through the Cloudflare account login, not through the app.

### A bad deploy

- **Symptom.** Errors or wrong behaviour that started right after a deploy from `main`.
- **Check.** `npx wrangler deployments list` shows recent versions with times. Compare to when the problem began.
  The Deploy workflow runs smoke tests, so a failure that got past them is usually a behaviour bug.
- **Action.** Roll back the Worker: `npx wrangler rollback` (previous version) or `npx wrangler rollback <version-id>`.
  For the Python Worker use `--name grading` (or `grading-sandbox`). This is a write to the live account, so decide
  first. A rollback only swaps the Worker code and config. It does not undo:
  - **D1 migrations.** Migrations are applied before the deploy and stay applied. Code that is rolled back must still work with the newer schema. Migrations here only add tables or columns, so that normally holds; check the
    migration that shipped. To undo data changes use Time Travel (section 1).
  - Secrets, Access settings, and queue or R2 contents.
  - Durable Object class changes (the `migrations` list in `wrangler.jsonc`); these do not rewind.
  - Messages that bad code already processed, and scores it already wrote (scores are append-only; a wrong score is
    corrected with a new revision, never edited).
  Then fix forward on a branch. The next push to `main` redeploys, so a rollback does not stay in place if `main` still
  holds the bad commit: revert the commit on `main` as well.

### The canary shows LỆCH

- **Symptom.** The "Độ ổn định" table on `/teacher/admin` shows `LỆCH` for a day. The canary grades one fixed input daily
  (03:17 UTC) and compares score and a hash of the raw LLM replies with the first run that used the same model and input version.
- **Check.**
  - Rows (read only): `... --command "SELECT ran_at, score, fingerprint, model, input_version, status, error FROM canary_runs ORDER BY ran_at DESC LIMIT 10"`.
  - Is `model` different from the baseline row? A silent model change upstream is the likely cause. Is `status` `error`?
    Then it is an outage (see the grader and quota playbooks), not nondeterminism.
  - Does only the fingerprint differ while the score is equal? The raw text changed but the result did not.
  - Did a deploy of `grading` or a prompt change happen that day? That needs a new `input_version`, not a bug.
  - See `docs/adr/0002-determinism-canary-in-d1.md` for how the baseline is chosen.
- **Action.** Wait for the next cron run and see whether that row differs too. A `LỆCH` caused by an `error` row says
  nothing about determinism. If the score truly changed with the same model and input, treat
  scores graded since then as suspect: tell teachers, and use the appeal path to re-check any score that matters.
  Do not edit canary rows.

## 3. Kill switches

Added in a separate change: an environment variable `DISABLED_FEATURES` (comma separated; names `similarity`,
`csv_export`, `bulk_import`, `appeals`) turns the listed features off, and those routes answer 404. It lives in a
different branch, so it may not be on `main` yet; see [`app-worker/README.md`](../app-worker/README.md) for how it is set
and what it covers once merged.

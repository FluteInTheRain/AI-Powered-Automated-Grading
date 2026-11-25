# Teacher app on Cloudflare — design

Status: draft for approval, 2026-11-25. Paths are relative to the repo root; line
numbers are deliberately omitted — find code by symbol name.

> VI: Bản thiết kế app giáo viên chạy hoàn toàn trên Cloudflare (cách B: Worker
> TypeScript mới + Worker Python hiện có làm dịch vụ chấm). Mục tiêu chính là học
> hệ sinh thái Cloudflare.

## 1. Intent and why

A small app for teachers. A teacher logs in, builds an exam (or picks problems from a
ready-made bank), shares a link with students, the AI grades submissions
automatically, and when a student disputes a score the teacher reviews how the AI
graded it and regrades by hand if needed.

**Why it exists:** the author wants to learn the whole Cloudflare platform by building
something real. Each Cloudflare product is added only when it has a real job in this
app. Never added just to tick a box.

> VI: Lý do chính là học Cloudflare. Mỗi sản phẩm chỉ được dùng khi có việc thật cho
> nó làm.

## 2. What exists today (reuse, do not rebuild)

- `worker/` — Python Worker (FastAPI on Pyodide) with D1, Workers AI, and a service
  binding to `sandbox-worker/`. Deployed at grading.khangnguyen.workers.dev. Config in
  `worker/wrangler.jsonc`, routes in `worker/src/app/routes.py`, schema in
  `worker/migrations/0001_init.sql`.
- `src/grader/` — grading pipeline (`pipeline.grade`, `rubric_checks`, `aggregator`,
  `feedback`). Copied into the Worker bundle at build time.
- Today: teacher pages have **no login** (secret `admin_token` in the URL); students
  give a name only; one `result` JSON per submission; per-call LLM audit rows in
  `grading_logs`; no appeals, no manual score, no problem bank.
- 16 reference problems live in `data/problems.py` (source of the bank seed).

## 3. Goals, non-goals, anti-goals

**Goals**
- Teacher login; exams owned by a teacher.
- Problem bank: teacher can pick ready-made problems or author their own.
- Student takes an exam from a link, is graded by the existing pipeline.
- Appeal flow: student files an appeal; teacher sees the full AI grading trail
  (prompts, raw responses, per-check results); teacher can keep or override the score,
  with a reason. Score history is never overwritten.
- Fully on Cloudflare, ideally on the Free plan; touch Access, D1, KV, R2, Queues,
  Durable Objects, Workflows, Cron Triggers, Turnstile, Rate Limiting, AI Gateway,
  Workers AI, Analytics Engine, Workers Logs, and CI deploy — each with a real job.

**Non-goals**
- No student accounts (link + name, as today). No multi-school/tenancy, billing, or
  mobile app.
- No rewrite of the Python grading pipeline. No new fine-tuning.
- Not hardened for high-stakes exams (same stance as README "Limitations").

**Anti-goals (failure even if it "works")**
- The LLM decides or recommends the outcome of an appeal. The teacher decides.
- Any rule in `CLAUDE.md` broken: correctness only from sandbox execution; non-correctness
  dimensions from small schema-constrained LLM calls; final score a fixed weighted sum in
  Python; no agent framework in the grading path.
- A Cloudflare product wired in with no real job.
- Silent overwrite of an AI score by a manual score.

## 4. Constraints

- Free plan only, $0 budget, workers.dev hostname (see "Answers from the author").
  Limits of each product must be re-checked on the Cloudflare docs at build time — they
  change. Where a product needs Workers Paid, drop it and note it; never silently pay.
- Python Worker cost: a grade takes ~90 ms CPU and ~4 LLM calls (about 100 Neurons;
  ~100 graded submits/day on the free 10,000 Neurons). See `worker/README.md`.
- Student code only ever runs in the binding-less `grading-sandbox` Worker.
- `worker/` and `server/` keep route parity (`tests/test_route_parity.py`). Changes to
  `worker/` must not break that.

## 5. Approaches considered

| | Approach | Trade-off | Result |
|---|---|---|---|
| A | Extend the Python `worker/` | One place, reuse all; but Python Workers are beta/slow and DO/Queues/Workflows docs are TypeScript-first | Rejected |
| **B** | **New TypeScript Worker for the teacher app; Python Worker becomes a stateless "grade" service over a service binding** | Two Workers, one contract between them; best learning path, pipeline untouched | **Chosen by the author** |
| C | Rewrite everything in TypeScript | Throws away the pipeline, tests and measured consistency results; teaches no Cloudflare | Rejected |

## 6. Architecture

```
Browser ─► app Worker (TypeScript, new: app/)
            ├─ Cloudflare Access ........ teacher login (JWT in header, verified in Worker)
            ├─ D1 ....................... users, problems, exams, submissions, scores, appeals
            ├─ KV ....................... problem-bank cache, feature flags
            ├─ R2 ....................... full LLM audit trail blobs, appeal attachments
            ├─ Queues ................... grading jobs (producer: app, consumer: app)
            ├─ Durable Object ........... one per (exam, student): timer + attempt lock
            ├─ Workflows ................ appeal lifecycle
            ├─ Cron Trigger ............. close expired exams, expire stale appeals
            ├─ Turnstile ................ student submit / appeal forms
            ├─ Rate Limiting binding .... per-IP limits on student endpoints
            ├─ AI Gateway ............... in front of Workers AI (logs, caching, limits)
            └─ service binding ──► grading Worker (Python, existing worker/)
                                     └─► grading-sandbox ─► (no bindings)
                                     └─► Workers AI
```

Key contract (the only coupling between the two Workers): a new **stateless**
endpoint on the Python Worker, e.g. `POST /internal/grade`, takes the problem
(statement, rubric, tests, func name) plus the student code and returns the
result JSON and the LLM `call_log`. It touches no DB. It is not reachable from the
public internet (service binding only). The exact shape is the builder's job, but it
must wrap the existing `grade()` and `generate_feedback()` calls unchanged.

The existing public routes of `worker/` stay as they are (live demo keeps working).

## 7. Data model (decisions, not DDL)

- **teachers** keyed by the identity from Access (email). First login creates the row.
- **problems** have an `owner` (a teacher, or `system` for the seeded bank) and a
  `visibility`; bank = `system` problems seeded once from `data/problems.py` by a script,
  never hand-edited.
- **exams** belong to a teacher and point at one or more problems (today's exam is 1:1
  with a problem; the app makes it 1:N — builder decides the table shape).
- **submissions** are immutable once written.
- **scores are append-only revisions**: revision 0 = AI score; each manual regrade adds a
  revision with `source` (`ai`|`teacher`), author, reason, timestamp. "Current score" =
  latest revision. Never `UPDATE` a score in place.
- **appeals** link to a submission, have a status
  (`open` → `under_review` → `upheld` | `adjusted` | `rejected`), the student's message,
  and the teacher's decision note.
- Large LLM audit payloads go to R2; D1 keeps an index (submission id, R2 key, call
  count). Short fields stay in D1.

## 8. Flows

1. **Teacher:** log in via Access → bank or own problem → create exam → copy student link.
2. **Student:** open link → Turnstile → name → get problem → (DO starts timer on first
   open) → submit → the app enqueues a grading job and returns a receipt code → page polls
   until graded → sees score and feedback.
3. **Grading job (Queue consumer):** call the Python Worker over the service binding →
   store result, score revision 0, audit blob in R2. Failed jobs retry, then go to a
   dead-letter queue and show as "grading failed" (never silently a zero).
4. **Appeal (Workflow):** student sends receipt code + message (Turnstile + rate limit) →
   Workflow creates the appeal and waits for the teacher → teacher opens the audit view
   (prompts, raw responses, checks) → decides: reject / adjust score (new revision with
   reason) → Workflow closes the appeal and notifies the student. A Cron Trigger expires
   appeals that sit too long and closes exams past their deadline.

## 9. Phases (each ends with something working and deployed)

1. **Foundation** — new TS Worker, D1 + migrations, Access login, teacher/problem/exam
   CRUD, bank seeded from `data/problems.py`, stateless `/internal/grade` on the Python
   Worker, synchronous grading through the service binding.
2. **Student flow, async** — Queues for grading, Durable Object for timer/attempt lock,
   R2 for audit trail, Turnstile + Rate Limiting on student endpoints.
3. **Appeals** — appeal table, score revisions, Workflow lifecycle, teacher review UI,
   Cron Triggers, notification (email if its plan allows, otherwise in-app).
4. **Operate it** — AI Gateway in front of Workers AI, Analytics Engine metrics, Workers
   Logs/tail, CI deploy (Workers Builds or GitHub Actions + wrangler), simple dashboards.

## 10. Decisions left to the builder

Table shapes beyond the rules in section 7, frontend framework (the existing
`frontend/` React + Vite can be reused or a new one built), exact `/internal/grade`
payload, Queue batching/retry numbers, Workflow step names, URL scheme.

## 11. Calls made by the assistant (author can reverse)

- Teacher login uses **Cloudflare Access** (One-time PIN, free tier) rather than a
  home-made password system; teacher identity comes from the verified Access JWT.
- Students stay **name + link only**; an appeal is authenticated by the **receipt code**
  returned at submit time (plus Turnstile).
- Appeal outcomes are decided **only by the teacher**; no AI "second opinion" in v1.
- Scores are **append-only revisions** rather than an editable field.
- Python Worker gets a **new internal stateless endpoint**; the old DB-backed routes stay.
- Free plan is a hard gate (confirmed by the author, see below).

### Calls added after the builder check (assistant's, author can reverse)

- **Own D1.** The new app has its own D1 database. The Python Worker's D1 and the live
  demo (exams, submissions, public routes) stay as they are; no migration, and old demo
  exams are not visible in the teacher app.
- **Access placement.** Access guards the teacher paths only (`/teacher/*`,
  `/api/teacher/*`); student paths bypass it. The Worker also verifies the Access JWT
  itself, so a missing Access policy fails closed. Local dev uses an explicit
  `DEV_AUTH_BYPASS` var that is never set in deployed config.
- **Authoring a problem.** Same as today's flow: the teacher gives statement, function
  name, parameter names, a reference solution, test inputs and rubric weights (defaults
  provided). Expected outputs are computed by running the reference solution in the
  sandbox, and the teacher previews them before publishing. Python only. Test cases are
  hidden from students (the existing "failed case inputs are shown" limitation is
  carried over and listed, not silently fixed).
- **Appeal outcome delivery.** The student has no email. They poll the appeal by receipt
  code. Email notification is a Phase 4 stretch only if a Cloudflare email product is
  usable on the plan; v1 does not collect student email.
- **Timer / attempt.** The Durable Object is keyed by a random attempt id issued when the
  student starts (the name is only a label, so two people with the same name do not
  collide). The time limit counts from first open and is also capped by the exam
  deadline; the server rejects submits after expiry (small grace period). No autosave in
  v1. The attempt id is kept in the browser so a closed tab can resume.
- **Grading call size.** One grading job = one (submission, problem). The Queue fans out
  per problem so each Python Worker call stays at the size already measured live.

### Answers from the author (2026-11-25)

1. **Domain:** the author has no domain and does not want to pay. Cloudflare does not
   give free custom domains; Workers get a free `*.workers.dev` hostname. Decision:
   **workers.dev only.** Cloudflare Access can protect a workers.dev hostname (docs).
   Consequence: no email sending (needs a domain), so appeal outcomes are shown in-app
   by receipt code. A custom domain is a later, optional upgrade.
2. **Exam shape:** an exam has one or **several questions**. Decision (assistant's
   detail): a student *attempt* covers the whole exam and has one receipt code; each
   question carries a teacher-set weight (default equal); exam total = weighted average
   of the per-question scores; grading jobs, score revisions and appeals are **per
   question**. One grading job = one (attempt, question).
3. **Money:** the budget is $0. **Free plan is a hard gate**: use every Cloudflare
   product that has a usable free tier, and never move to Workers Paid. A product with
   no usable free tier is dropped and noted; the app falls back (e.g. grade inline with
   `waitUntil`) and the roadmap says which learning item was skipped.

### Free-tier facts to design around (from Cloudflare docs, checked 2026-11-25; re-check at build time)

- Workers Free: 100,000 requests/day, 10 ms CPU per request, 50 subrequests per request.
  The Python grading Worker already exceeds 10 ms CPU (~90-176 ms) and has so far not
  been cut off; this stays an accepted, documented risk from the deploy design.
- Queues Free: 10,000 operations/day (one message costs several operations), 24 h
  message retention, 128 KB messages.
- Durable Objects Free: SQLite-backed only; 100,000 requests/day.
- Workflows Free: 3,000 steps/day, 10 ms CPU per invocation, 3-day state retention. The
  appeal Workflow must stay few steps; metering began on 2026-08-10 per the changelog.
- Access on workers.dev is supported; the Zero Trust Free user cap was not confirmed
  from the docs and must be checked when setting it up.
- Workers AI Free: 10,000 Neurons/day, about 100 graded questions/day at the current
  model. This is the real daily ceiling of the whole app.

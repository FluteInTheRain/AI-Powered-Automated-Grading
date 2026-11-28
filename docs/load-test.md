# Load and capacity test: a class of 30 submitting one exam

Task T7.2. The question: what happens when 30 students submit one exam at the same moment, on the Cloudflare Free plan, and how many students per day can the app serve?

Short answer: the daily Workers AI allowance of 10,000 Neurons is the first limit hit. A 5-question exam costs about 500 Neurons per student, so the app grades about 20 students per day, and a class of 30 does not fit. Everything else (queries, subrequests, queue operations, requests) has at least 30 times more room.

Nothing in this document was measured on the live deployment. No load was sent to any workers.dev URL and no wrangler command touched the live account. The local runs use a fake grader and say nothing about Workers AI, real grading time or Cloudflare's network.

## 1. Capacity model

### Free plan limits

Checked on the Cloudflare docs on 2026-11-28.

| Limit | Value | Source page |
|---|---|---|
| Workers requests | 100,000 per day | Workers limits |
| Workers CPU per request | 10 ms | Workers limits |
| Subrequests per invocation | 50 | Workers limits |
| D1 queries per invocation | 50 (one `db.batch()` counts as one query) | D1 limits |
| D1 rows read / written | 5,000,000 / 100,000 per day | D1 pricing |
| Queues operations | 10,000 per day; a message costs 3 (write, read, delete); a retry costs 1 extra read | Queues pricing |
| Queues throughput, consumer concurrency, batch | 5,000 messages per second per queue, 250 concurrent consumers, 100 per batch | Queues limits |
| Durable Objects | 100,000 requests per day (each RPC call is one request), 5,000,000 rows read and 100,000 rows written per day | Durable Objects pricing |
| Workers AI | 10,000 Neurons per day; `@cf/qwen/qwen2.5-coder-32b-instruct` costs 60,000 Neurons per million input tokens and 90,909 per million output tokens | Workers AI pricing |
| Workers AI text generation rate | 300 requests per minute default | Workers AI limits |
| Rate Limiting binding | counted per Cloudflare location, approximate, period 10 or 60 s | Rate limit binding |

What I could not verify:

- Whether queue consumer invocations and service-binding calls count toward the 100,000 Workers requests per day. The pages I read do not say. The model below counts them, which is the cautious reading.
- Whether the 300 requests per minute Workers AI default applies to Free accounts and to this 32B model. The page only says models that need the Paid plan get a lower limit.
- What the grading Worker does when the Neuron allowance runs out. I did not run it; the app-side consequence below is read from `app-worker/src/jobs.ts`.
- CPU time of the app-worker routes. Only the Python grader's 90 to 176 ms is documented (`worker/README.md`), and it is an accepted risk there.

### Real cost of one student with 5 questions

From the code (`app-worker/src/routes/student.ts`, `jobs.ts`, `grader.ts`) and from `app-worker/test/capacity_costs.test.ts`, which counts D1 statements per route. The test counts every `prepare()`, so its numbers are upper bounds on D1 queries.

| Step | D1 statements | Other subrequests |
|---|---|---|
| Start attempt | 3 | 2 Durable Object calls |
| Submit (5 questions) | 14 (5 queries if the batch counts as one) | 2 Durable Object calls, 1 queue `sendBatch` of 5 messages |
| One status poll | 5 | none |
| Grade one question (one queue message, one invocation) | 7 | 1 grader call, 1 R2 write |
| Grader Worker per question | not measured here | about 4 Workers AI calls and 1 sandbox call (`worker/README.md`) |

Every route stays far below the 50 queries and 50 subrequests per invocation. The submit route is the largest, at 14 statements against 50.

Writes per student, counted from the migrations (table row plus its indexes): attempt 5, five submissions 15, five jobs 20 (insert plus two status updates), five score revisions 15. About 55 rows. This is an estimate from the schema, not a measurement.

### Arithmetic for a class of 30 with 5 questions

Questions to grade: 30 x 5 = 150, so 150 queue messages and 150 grader invocations.

| Resource | Use for the class | Free allowance | Share used | Students per day at this limit |
|---|---|---|---|---|
| Workers AI Neurons | 150 x 100 = 15,000 | 10,000 | 150% | 10,000 / (5 x 100) = 20 |
| Queue operations | 150 x 3 = 450 | 10,000 | 4.5% | 10,000 / 15 = 666 |
| D1 rows written | 30 x 55 = 1,650 | 100,000 | 1.7% | 100,000 / 55 = 1,818 |
| Workers requests, with a 10 s wait | 30 x (3 + 5 x 5 polls + 5 consumer) = 990 | 100,000 | 1% | about 3,000 |
| Durable Object requests | 30 x 4 = 120 | 100,000 | 0.1% | 25,000 |
| Subrequests per invocation | at most 3 | 50 | 6% | not a daily limit |
| Queue throughput | 150 messages in about 8 s, 20 per second | 5,000 per second | 0.4% | not a daily limit |

The 100 Neurons per graded question come from `worker/README.md` (three samples, 93 to 102 Neurons, from token counts at the published rate on 2026-11-18, not from the billing page). A question that passes no test skips the three rubric checks and costs about a quarter of that; a blank answer costs nothing.

The request row depends on how long a student waits. The exam page polls each question every 2 seconds, so one student makes 5 x (wait / 2 s) polls. With a 10 second wait that is 25 polls; with a 400 second wait (the local single-consumer case below) it is about 1,000 polls and the same class would use 30 x 1,000 = 30,000 requests.

### First limit hit and the daily ceiling

Workers AI Neurons. With 5 questions per exam the app grades 10,000 / 100 = 100 questions a day, which is 20 students. With Q questions the figure is 100 / Q students.

A class of 30 therefore overruns the allowance by half. Queue messages are sent per student, so the first 20 submitters are graded in full, assuming the queue delivers roughly in order. The other 10 get questions that fail with a grader error. In `jobs.ts` a transient failure is retried after 30 s, then 60 s, and after the third delivery the job is marked failed with no score. The student can retry once the allowance resets at 00:00 UTC (07:00 in Vietnam). Whether the grader reports an empty allowance as a retryable error was not tested.

The next limit is Queue operations at about 666 students per day, 33 times further away, and the Neuron limit also falls first when a teacher runs several classes in a day.

Even without the Neuron cap, 600 LLM calls (150 questions x 4 calls) in one burst would take at least two minutes if the 300 requests per minute default applies.

## 2. Local simulation

### Method

`scripts/load_test.mjs` starts `wrangler dev --local` for `app-worker` with local D1 (migrations plus `seed/bank.sql`), local Queues, Durable Objects and R2, and a second Worker named `grading` (`scripts/loadtest/fake_grader.mjs`) bound as the `GRADER` service. The fake returns a valid grade after a configurable delay. It calls no model and no sandbox. No app code was changed to swap the grader.

It then creates an exam with 5 bank questions, starts N attempts spread over 2 seconds, submits all N within a 5 second window, and polls every question every 2 seconds as the exam page does, until every question is done or failed. It records the time the submit is accepted, the time of the last score, the number of queued and grading questions every second, HTTP statuses, 429 responses and queue deliveries (retries are deliveries minus questions, read from `grading_jobs.attempts`).

Parameters: `--students`, `--questions`, `--latency-ms`, `--jitter-ms`, `--fail-rate`, `--window-ms`, `--start-window-ms`, `--poll-ms`, `--ip-mode distinct|shared`, `--timeout-ms` (per question polling), `--hard-timeout-ms` (whole run), `--port`, `--seed`.

Safety: the script refuses any base URL that is not `localhost` or `127.0.0.1` and never passes `--remote` to wrangler.

### The test seam

The student start route calls Turnstile, which fails closed without a real token. One seam was added in `app-worker/src/routes/student.ts`: with the variable `LOADTEST_SKIP_TURNSTILE` set to `1`, the Turnstile check is skipped, and only when the request URL's hostname is `localhost` or `127.0.0.1`. The variable is passed as a `--var` by the load test and is not in `wrangler.jsonc`. A deployed Worker is reached through its workers.dev or custom hostname, so the flag does nothing there even if someone sets it. `app-worker/test/loadtest_seam.test.ts` covers this. Teacher login uses the existing `DEV_AUTH_BYPASS` that local development already has.

### What failed to run, and what is a limit of the local stack

The whole stack does run locally: D1, Queues, Durable Objects, R2, Rate Limiting and the service binding all worked. Three things limit what the numbers mean.

1. The local queue consumer runs one message at a time. `peak_grading_at_once` was 1 or 2 in every run (the 2 is a sampling overlap), and `max_concurrency` set in the config was ignored by the local broker. Production consumers scale up to 250 invocations. So the local time to the last score is a single-consumer figure: questions x mean latency. The 30-student run confirms it: 150 x 0.625 s is 94 s against 97.7 s measured.
2. A first set of longer runs (30 students at 4 s latency, and a 100-student shared-IP run) was invalid: the laptop slept for about 2,000 seconds and the exam clocks and timers ran on across it. I deleted those results and reran with `caffeinate`. A 30-student run at 4 s latency would need 150 x 5 s, about 12.5 minutes, because of point 1, so it was replaced by the model below.
3. Runs overlapped on one laptop. The 100-student distinct-IP run shared the machine with three other runs, which inflated its poll latency (p95 1.6 s against 11 ms alone). The other runs overlapped as well. Treat latencies as an order of magnitude.

### Results

Local simulation, fake grader, single local consumer, 5 questions per student, 2 second polls. Not measurements of production.

| Run | Students | Fake grade latency | IP mode | Fail rate |
|---|---|---|---|---|
| A | 30 | 500 ms + 0 to 250 ms | distinct | 0 |
| B | 100 | 500 ms + 0 to 250 ms | distinct | 0 |
| C | 100 | 100 ms | one shared IP | 0 |
| D | 30 | 100 ms | distinct | 20% |

| Measure | A (30) | B (100) | C (100, shared IP) | D (30, 20% fail) |
|---|---|---|---|---|
| Submits accepted | 30 of 30 | 100 of 100 | 100 of 100 | 30 of 30 |
| Submit window | 4.9 s | 4.9 s | 4.9 s | 4.9 s |
| Accept time of a submit, p50 / p95 / max | 7 / 23 / 26 ms | 7 / 17 / 22 ms | 6 / 14 / 22 ms | 115 / 297 / 893 ms |
| Accept time of a start, p50 / max | 7 / 13 ms | 6 / 16 ms | 3 / 20 ms | 62 / 132 ms |
| Last submit accepted at | 7.5 s | 7.5 s | 52.4 s | 8.4 s |
| Time to the last score, from the first start | 97.7 s | 415 s | 72.6 s | 131 s |
| Wait per student after accept, p50 / max | 50 / 90 s | 163 / 408 s | 14 / 28 s | 58 / 123 s |
| Peak queue backlog (questions queued) | 140 | 490 | 238 | 129 |
| Questions graded | 150 of 150 | 500 of 500 | 500 of 500 | 145 of 150 |
| Queue deliveries / retries | 150 / 0 | 500 / 0 | 500 / 0 | 201 / 51 |
| Questions failed after 3 deliveries | 0 | 0 | 0 | 5 |
| 429 rate limit responses | 0 | 0 | 649 on start | 0 |
| Other errors | 0 | 0 | 0 | 0 |
| HTTP requests | 3,581 | 42,367 | 4,169 | 2,004 |

Run D also ran next to other runs, which explains its slower accept times.

### Model driven projection (a model, not a run)

The local consumer cannot show how fast production drains the queue. This projection uses the model: 150 jobs, each taking L seconds, C consumers draining in parallel, time to the last score about ceil(150 / C) x L plus one poll interval. Assume L = 5 s (four model calls of 1 to 2 s plus a sandbox run; no real figure exists here).

| Consumers C | Time to the last score |
|---|---|
| 1 (what wrangler dev does) | 750 s |
| 10 | 75 s |
| 50 | 15 s |
| 150 or more | about 5 to 7 s |

The model ignores Workers AI throttling and the 300 requests per minute question, so it is a best case. Run A at C = 1 is the one point on this curve that a run confirms.

## 3. What the numbers show and do not show

They show:

- The submit path is cheap and does not queue behind grading. Accepting 100 submits in 5 seconds took 7 ms at the median and 22 ms at worst, with zero errors. The burst is absorbed by the queue and the 14 statements of a submit sit well under the 50 query limit.
- Queue retries and the failure path work as written: with 20% injected failures, 51 retries, 5 questions that ended failed with no score, and nothing lost.
- Rate limits behave as configured. With all 100 students behind one IP, `RL_START` (60 starts per minute per IP) rejected 649 attempts, and the last student started 52 seconds in. A class of 30 behind one school NAT stays under 60 starts a minute, so it is not rejected; this is arithmetic, not a run.
- Polling is the main source of requests. With a slow queue the 100-student run produced 42,000 requests, 99% of them polls.

They do not show:

- Anything about real grading time, the sandbox, Workers AI latency, throttling or Neuron use. The fake grader sleeps.
- How the production queue scales. The local consumer is single-flight.
- Cloudflare network, D1 and Durable Object latency, or the 10 ms CPU limit. Local runs enforce none of the Free plan limits.
- That 20 students a day is exactly right. It rests on 100 Neurons per question, which comes from token counts on three samples.

## 4. The binding constraint

Real Free plan limits decide this, not the local numbers. The Neuron allowance of 10,000 per day is the first limit, at about 20 students with 5 questions each, and a class of 30 exceeds it by 5,000 Neurons.

## 5. What a production run would need

Not done, on purpose.

- A staging environment: a second Workers deployment (`teacher-app-staging`) with its own D1 database, queue, R2 bucket and Durable Object namespace, so fake attempts never reach production data.
- A separate AI budget: Workers AI Neurons are per account per day, so a real run on the Free plan would use up the day's allowance for production. It needs another account, or the Paid plan with a spending cap.
- A way to avoid Turnstile and per-IP limits on staging, such as a staging site key with Cloudflare's test secret, and a client spread over several IPs.
- Real exam content and a few real grading runs first, to replace the 100 Neurons per question and 5 s latency assumptions with measured ones.
- Agreement from the account owner before any traffic, since a run also trips Rate Limiting and fills D1.

## Reproduce

```bash
cd app-worker && npm ci && cd ..
node scripts/load_test.mjs --students 30 --latency-ms 500 --jitter-ms 250
node scripts/load_test.mjs --students 100 --latency-ms 500 --jitter-ms 250
node scripts/load_test.mjs --students 100 --ip-mode shared --latency-ms 100
node scripts/load_test.mjs --students 30 --fail-rate 0.2 --latency-ms 100
```

Results are written as JSON to `results/` (gitignored) with the per-second timeline. On a laptop use `caffeinate -i` for runs longer than a few minutes.

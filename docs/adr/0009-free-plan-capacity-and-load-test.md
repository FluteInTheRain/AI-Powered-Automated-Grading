# 0009. The Free plan allows about 20 five-question students per day, and what to do beyond that

Status: accepted, 2026-11-28 (T7.2)

## Context

A teacher wants to run one exam for a class of 30 on the Cloudflare Free plan. `docs/load-test.md` models the cost of one student with 5 questions from the code and the Cloudflare docs checked on 2026-11-28, and runs the app locally against a fake grader. Local runs do not measure production.

## Decision

The binding limit is Workers AI at 10,000 Neurons per day. One graded question costs about 100 Neurons (`worker/README.md`, from token counts), so a 5-question exam costs about 500 Neurons per student and the app grades about 20 students per day, or 100 divided by the number of questions. A class of 30 needs 15,000 Neurons and does not fit. The next limit, Queue operations at 10,000 per day, allows about 666 students, so Neurons are 33 times tighter. Queries per invocation (at most 14 statements against 50), subrequests (at most 3 against 50), queue throughput and Durable Object requests are not binding.

When the limit is exceeded:

1. Split a class of 30 across two days, or give each exam at most 3 questions (about 33 students per day).
2. Raise the budget only by the owner's choice: Workers AI on the Paid plan with a spending cap. The Free plan stays the default (project rule: never move to Paid without being asked).
3. Do not change the grading design to save Neurons (no LLM-scored correctness, no merged rubric prompts). Those rules are fixed in `CLAUDE.md`.
4. Students whose questions fail after the allowance runs out can press retry after 00:00 UTC (07:00 in Vietnam). The job is marked failed with no score after three deliveries.

## Consequences

The class-of-30 plan is a documented limit, not a bug. Open points that a staging run would settle: how the grading Worker reports an empty allowance, whether the 300 requests per minute Workers AI default applies on Free, and whether queue consumer invocations count toward the 100,000 daily requests. A production-scale test needs a staging deployment and a separate AI budget; it was deliberately not run.

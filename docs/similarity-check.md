# Code-similarity signal (PR-E3)

A teacher-only hint that two students' code for the same question looks alike. It is a reason to look again, not evidence
of copying, and it never changes a score: the endpoint only reads D1.

## Where it lives

- `app-worker/src/similarity.ts`: pure functions (normalize, shingles, Jaccard, `findSimilarPairs`). Plain TypeScript, no
  dependency, no LLM, no Node globals (the Workers runtime has no `Buffer`).
- `app-worker/src/db/similarity.ts`: reads the exam's questions and submissions (one D1 batch of two queries).
- `GET /api/teacher/exams/:id/similarity`: behind Access like the other teacher routes; an exam owned by someone else gives 404.
- `app-ui/src/components/SimilarityPanel.jsx`: the "Bài giống nhau" panel under the results table.
- Tests: `app-worker/test/similarity.test.ts`, `app-ui/test/SimilarityPanel.test.jsx`.

## Method

1. Tokenize the Python source. Comments and docstrings (triple-quoted strings) are dropped, whitespace is ignored.
2. Normalize: strings become `STR`, numbers `NUM`, every user identifier `ID`. Keywords and common builtin functions
   (`len`, `range`, `sorted`, ...) stay, because choosing them is part of the algorithm. Method names such as `values` or `get`
   are not kept, since students use them as variable names.
3. Take 5-token shingles (k-grams) of the stream and remove any shingle that also appears in the question's starter code.
4. Compare two submissions with Jaccard similarity of their shingle sets.

A renamed copy therefore scores near 1. A different algorithm for the same problem (hash map versus sorted two pointers)
scores well below 0.5. Reordering statements or changing the logic lowers the score; the signal cannot see those copies.

## Thresholds and why

| Constant | Value | Reason |
| --- | --- | --- |
| `MIN_TOKENS` | 40 | After normalization and without the starter code, a shorter solution has only a few sensible shapes. A one-line sum will always look like every other one-line sum. A typical hash-map `two_sum` is about 50 tokens, a short loop around 25 to 35. |
| `SHINGLE_K` | 5 | Long enough that a shared shingle reflects shared structure, short enough to survive a small edit. |
| `SIMILARITY_THRESHOLD` | 0.85 | A pair is listed only when at least 85% of the combined shingles are shared. These numbers are a starting choice from hand-made cases, not tuned on real exam data; retune once a class has been through it. |

Also skipped, and counted in `skipped`:

- unchanged starter code (nothing left after step 3);
- a submission that itself reaches the threshold against the question's reference solution. Everyone who solves the
  problem the standard way converges on it, so a match between two such students tells the teacher nothing.
  The cost: a student who copies the reference solution is not listed either.

Limits: at most 150 eligible submissions per question are compared (`truncated: true` otherwise, because pairs grow with the
square and Workers CPU time is small) and at most 20 pairs per question are returned, highest first.
Student names are not identities (see the app-worker README), so a pair names two attempts, not two verified people.

## Response

```json
{ "threshold": 0.85, "min_tokens": 40,
  "questions": [{ "problem_id": "...", "position": 0, "compared": 12, "skipped": 3, "truncated": false,
                  "pairs": [{ "a": {"attempt_id": "...", "student_name": "An"},
                              "b": {"attempt_id": "...", "student_name": "Bình"}, "similarity": 0.93 }] }] }
```

## Wording rule

UI text says "đáng xem lại" and states that it is not a conclusion and does not change scores. It never says "chép bài".

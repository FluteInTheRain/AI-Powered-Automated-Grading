# Pilot Dataset — Automated Programming Grading

65 samples, 16 original problems, 4-5 solutions per problem simulating different kinds of errors.
(The first 8 problems / 33 samples were the original pilot set, used for the
Phase 1/2 experiments in `docs/thesis/results.md`; problems P09-P16 were
added in T3.1 to cover string processing, simple data structures, and
recursion beyond fibonacci — problem types not represented in the original 8.)

## Structure of each sample (`dataset.json`)

```
sample_id, problem_id, statement, rubric,
submission_code,
execution_result: { pass_count, total_tests, pass_rate, status, sample_errors },
sub_scores_0_to_1: { correctness, efficiency, code_style, edge_case_handling },
final_score_0_to_100,
annotation_source: origin of each sub-score
```

## Score origins — read carefully before using this for the thesis

| Criterion | Source | Reliability |
|---|---|---|
| correctness | Real code run against test cases in a sandbox | 100% objective |
| edge_case_handling | Derived directly from real execution pass_rate | 100% objective |
| efficiency | Fixed rule based on the algorithmic complexity I classified myself when writing the submission | Single-rater, NOT real ground truth |
| code_style | Fixed 3-level rule (clean/medium/poor) I assigned myself | Single-rater, NOT real ground truth |

**Most important limitation:** this data is code I wrote myself with deliberately injected bugs, self-classified — it is not real student work, and there are no scores from a real instructor. It can be used to:
- Test whether the pipeline (sandbox execution + rubric decomposition) runs correctly.
- Measure LLM consistency (running the same input 100 times) — this does NOT require real ground truth, only a fixed input.
- Bootstrap before real data is available.

It CANNOT be used to:
- Report "the model achieves X% correlation with humans" in the thesis — because the "human" here is me self-labeling by rule, not an independent instructor grading.

**Next step needed:** take these 65 samples (or a further-expanded set), have 1-2 instructors/TAs grade them independently using the same rubric, and compute Cohen's kappa or ICC between these rule-based scores and the real human scores. If agreement is high, the rule-based labels can be used to scale the dataset to hundreds of samples without needing a human to grade everything. If agreement is low, the rubric needs to be rewritten more clearly before scaling.

## Notable finding from running the real pipeline

Two submissions I designed to be buggy (`P01_two_sum__S3`, `P02_is_prime__S4`) actually **pass 100% of test cases** — because the current test suite isn't strong enough to catch that bug (missing a strict duplicate-value case for S3, missing a perfect-square-prime case for S4). This isn't a tool bug — it's empirical evidence for an important point to make in the Proposed Method / Literature Review section: **the quality of ground-truth correctness depends directly on test suite coverage** — if the test suite is weak, sandbox execution will also produce a wrong score. Worth citing this finding when discussing rubric design.

Same class of issue caught and fixed during T3.1: `P12_valid_parentheses__S3`'s injected bug (missing the "leftover unmatched opening brackets" check) initially passed 6/6 test cases because none of them covered an unclosed-bracket input — added `"("` and `"[[["` as test cases so the bug is actually exercised. Lesson for anyone adding more problems: always run the buggy submissions against the test suite and check they actually fail, don't just trust that writing a bug means the test suite will catch it.

## How to extend the dataset

Edit `problems.py` — add new problems to the `PROBLEMS` list, each needing `statement`, `func_name`, `rubric` (4 criteria summing to 100), `test_cases` (ideally at least 5-6 cases covering edge cases), `submissions` (minimum: 1 clean-correct, 1 correct-but-poor-performance/style, 2-3 different kinds of incorrect). Then rerun:

```
python3 build_dataset.py
```

## Next step for testing consistency (your original question)

Take `submission_code` + `statement` + `rubric` from any sample in `dataset.json`, feed it into the model with the same prompt, call the API 100 times with `temperature=0`, WITHOUT batching requests (call sequentially, or use separate `n=1` calls, to rule out floating-point noise from dynamic batching). Count how many distinct score values appear across the 100 runs — if >1, that is an exact-match consistency rate < 100%, and it should be recorded to compare across architectures (free-form scoring vs. decomposed rubric + constrained decoding).

---
description: Run the consistency experiment on one sample and report a terse summary
---

Run `python3 experiments/consistency_test.py --sample_id $1 --n ${2:-100}` (use
defaults from `configs/model.yaml` for `--base_url`/`--model` unless the user
overrides them in the arguments).

After it finishes, read `results/consistency_<sample_id>.json` and report ONLY:
- exact_match_rate
- n_unique_scores and what the distinct scores were (if >1)
- one-sentence verdict: consistent enough, or not, per the project's 100%
  exact-match requirement

Do not paste the full JSON or the per-run log into the reply. If the run
fails because no server is reachable at the configured base_url, say so
plainly and stop — don't retry blindly.

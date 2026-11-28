# Architecture decision records

One file per decision: context, decision, consequences. Numbered in the order written. Source design: `docs/superpowers/specs/2026-11-27-phase4-observability-design.md`.

- [0001](0001-two-metric-audiences-in-app-pages.md) — Two metric audiences, both as in-app pages
- [0002](0002-determinism-canary-in-d1.md) — Determinism is measured by a daily canary stored in D1
- [0003](0003-ai-gateway-cache-off.md) — AI Gateway in front of Workers AI, response cache off
- [0004](0004-overturn-signal-is-not-human-agreement.md) — Appeal overturn rate is a biased single-rater signal, not accuracy
- [0005](0005-metric-writes-are-best-effort.md) — Metric writes never affect grading
- [0006](0006-feature-flags-as-kill-switches.md) — Feature flags are kill switches in one env var

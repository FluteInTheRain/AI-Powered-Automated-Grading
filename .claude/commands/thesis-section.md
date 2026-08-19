---
description: Draft one thesis report section from current code/results/docs, citing sources already in docs/architecture.md
---

Section requested: $ARGUMENTS

Draft this section using only what's already grounded in this repo:
`docs/architecture.md` for design rationale and citations, `results/*.json`
for any experiment numbers (state plainly if a needed result doesn't exist
yet rather than inventing one), and `data/script.md` for dataset caveats.

Write it as a file under `docs/thesis/` (create the dir if needed), not
inline in chat unless the user asks for inline. Keep citations as arXiv IDs
already used in `docs/architecture.md`; do not fabricate new citations —
flag it to the user if a claim needs a source we don't have yet.

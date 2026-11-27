# 0004. Appeal overturn rate is a biased single-rater signal, not accuracy

Status: accepted, 2026-11-27 (T6.5)

## Context

The developer page can show how often appeals change a score. `CLAUDE.md` forbids calling teacher agreement "agreement with human graders": only disputed submissions appear (selection bias) and one teacher decides.

## Decision

The page shows appeals filed, decided, adjusted and the mean score change on adjusted appeals, computed from D1 on read, under the label "overturn signal (selection-biased, single rater)". It never uses the word accuracy or agreement.

## Consequences

No duplicate copy in Analytics Engine. Anyone writing up results must keep this caveat.

# Appeals (T6.4) — design

Status: draft for author approval, 2026-11-27. Extends Phase 3 of
`2026-11-25-teacher-app-cloudflare-design.md` (sections 7-9, 11); where this file is
silent, that spec stands.

## Intent

A student who disagrees with the score on one question can appeal it. The teacher sees the
full AI grading trail and decides. The student finds the outcome by entering their receipt
code. The teacher decides; the AI never gives a second opinion.

## Goals

- Student files one appeal per question, using the attempt's receipt code (+ Turnstile and
  the existing rate limit).
- Student looks up an appeal by receipt code and sees status, the teacher's note, and the
  new score if it changed.
- Teacher sees a list of appeals per exam and an appeal detail with the audit trail
  (prompts, raw responses, per-check results; R2 / `grading_logs`).
- Teacher decision: `upheld` (score stays), `rejected` (no merit; score stays), or
  `adjusted` (new score). `adjusted` appends a `score_revisions` row
  (`source='teacher'`, reason) in the same D1 batch as the status change.
- A daily Cron expires appeals left `open` too long.

## Non-goals / anti-goals

- No email in this change (see "Email: not part of this work"). No AI opinion on appeals.
- No in-place score edits, ever (`score_revisions` stays append-only).
- No Workflows: waiting for the teacher is one API call updating D1, so Workflows would add
  a component without buying anything at this scale.
- Failure mode to avoid: a decided appeal changing the visible score without a matching
  revision row.

## Approaches considered

| | Trade-off |
|---|---|
| **A. D1 status + Cron (chosen)** | Smallest, fewest moving parts, matches CLAUDE.md priority (simple first). |
| B. Cloudflare Workflows | Durable wait for a teacher event; extra binding/config, free-plan limits unchecked, no gain here. |

## Decisions

- Statuses: `open` → `under_review` → `upheld` | `adjusted` | `rejected`, plus `expired`
  (assistant's call, added for the Cron).
- One appeal per (attempt, question). A decided or expired appeal cannot be refiled
  (assistant's call).
- Expiry: `open` appeals older than 14 days become `expired` (assistant's call, easy to
  change).
- New migration `0005`: `appeals` table. Table shape beyond the above is the builder's.
- UI: student result page gets an "Appeal" action and a status view; teacher gets an
  appeals page per exam. Existing look and the bilingual/theme conventions apply.

## Email: not part of this work

No email, no email field, no notification hook. The student learns the outcome only by
entering the receipt code. (Why: Cloudflare email needs a domain and a paid plan; Brevo
free with a Gmail sender is flagged as failing DKIM/DMARC, so delivery is unproven.)
Revisit only if the author gets a domain.

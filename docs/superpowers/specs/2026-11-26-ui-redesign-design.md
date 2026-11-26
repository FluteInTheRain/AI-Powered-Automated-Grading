# App UI redesign (short design)

Status: approved by the author on 2026-11-26 after reviewing the interactive mockup in `assets/2026-11-26-ui-redesign-mockup.html`.

## Intent
The app UI (a dark LeetCode-style theme with an orange accent) looked generic and not like the rest of the author's work. Give it the FluteInTheRain look and a flatter, tool-like layout, with a light and a dark theme.

## Goals
- Same design tokens as the author's site (warm paper colours, brick red `#B3402F`, Noto Sans), light by default, a lighter warm dark theme, a toggle that remembers the choice.
- Operate-mode layout: flat panels split by 1px rules, tables instead of card grids, status as a dot plus text, one primary button per screen, one icon set (stroke SVG) instead of glyphs.
- Exam screen as three panes (questions, statement, editor), a progress bar, "saved" indicator, previous/next buttons.
- Responsive: tables become stacked lists under 720px, the exam panes become an "Đề bài / Bài làm" tab pair under 900px. Base text 16px.
- Results page: search by student and a "needs review" filter.

## Non-goals
No API, logic or data changes. No new dependencies. No resizable panes, no new features beyond the list above.

## Approaches considered
A: recolour only. B: recolour and rework the layout in the existing CSS and JSX (chosen). C: Tailwind or a component library (rewrite, extra dependency).

## Design rules applied (from the Anthropic frontend-design and Vercel web-interface-guidelines skills, read as references, not installed)
No eyebrow labels, no uppercase labels, no identical card grid, no lift-on-hover, no gradient or glass, no emoji or glyphs as icons, visible `:focus-visible`, `prefers-reduced-motion`, `color-scheme`, tabular numbers, labelled icon buttons.

## Calls made by the builder
- Submit keeps the existing inline confirm bar (not a dialog) so behaviour and tests stay as they are; it now states how many questions are unanswered.
- "Run Tests" keeps its English label (tests and the earlier UI use it).
- Monaco follows the theme (`vs` / `vs-dark`).

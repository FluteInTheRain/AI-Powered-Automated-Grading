# 0007. Observed difficulty is a hint about the label and the sample, not about ability

Status: accepted, 2026-11-28 (T7.4)

## Context

Every problem carries a declared difficulty (easy, medium, hard). Teachers pick problems by it, and nothing checks it against what students actually do. The teacher page can compare the two from D1 without a migration. Like ADR 0001 and 0004, the number must not be read as more than it is.

## Decision

`GET /api/teacher/difficulty-calibration` returns, for each problem used in the teacher's own exams, the count n of first scored attempts, the share that pass every hidden test with a 95% Wilson interval, the mean total score, and a verdict. The page "Độ khó thực tế" shows it as a table. The rule and its constants live in `app-worker/src/difficulty.ts`; the query is one statement in `app-worker/src/db/difficulty.ts`.

Counting: one submission per student name and problem across the teacher's exams (the earliest); score is the latest revision, so appeal adjustments count; pass or fail comes from revision 0's execution result; blank answers (starter code unchanged), ungraded, failed and unreadable items are left out.

Rule: reference bands for the pass rate, easy 0.60 to 1.00, medium 0.30 to 0.75, hard 0.00 to 0.50. A problem is flagged "looks easier than its label" only when the whole interval lies above the band, and "looks harder" only when it lies entirely below. An interval that touches an edge is not flagged. The bands are working assumptions of this project, not measured values; they are meant to be edited.

Minimum evidence: N = 20 attempts. Below it the page says "not enough data" and never flags. At n = 20 the interval is about 0.2 wide on each side at worst, so only a clear gap (for example 20 of 20 on a hard problem, lower bound 0.84) clears a band edge. Below 20 the interval is wider than the 0.25 to 0.30 gaps between band edges and a flag would mostly describe who happened to take the exam. A class of 30 is still a small sample, and the page says so.

The mean score is shown but does not enter the verdict: partial credit for style and efficiency moves it independently of whether the code is correct.

The stored difficulty is never changed by this code. It is a prompt for the teacher to look again.

## Consequences

It is a statement about the label measured on this sample, not about student ability. Known biases:

- Self-selected classes: a teacher gives a problem to a class that is stronger or weaker than students in general, so the same problem can look easy for one teacher and hard for another. Bands cannot separate problem difficulty from class level.
- Retries: only a student's first submission counts, but a student who saw the problem in another teacher's exam, or under another name, is invisible here.
- Appeal adjustments: the mean score includes them; pass or fail does not, so the two can disagree after an appeal.
- Hints and aids: students may have had help, public test cases or outside tools, which raises pass rates in ways the label does not reflect.
- Blank answers are excluded, which also drops students who gave up, so hard problems can look easier than they were.

Anyone quoting these numbers must keep these caveats. No migration and no extra storage: everything is computed from existing tables on read.

/**
 * Difficulty calibration (T7.4): does a problem's declared difficulty look wrong, judged by real results?
 *
 * The rule, in one place:
 *  - Statistic: the share of first scored attempts that pass every hidden test (`passed / n`), with a 95% Wilson
 *    score interval. Wilson stays inside [0, 1] and behaves at 0% and 100% and at small n, which a plain
 *    p +/- 1.96*sqrt(p(1-p)/n) does not.
 *  - Reference bands: the pass-rate range we would expect for each declared difficulty. They are working assumptions
 *    of this project, not measured constants; edit BANDS to change the rule (the tests read it from here).
 *  - Verdict: flag only when the WHOLE interval lies outside the band. An interval that touches the band edge is not
 *    flagged. Below MIN_ATTEMPTS nothing is flagged at all.
 *  - A problem can only look easier than "hard"/"medium" labels allow, or harder than "easy"/"medium" allow: the
 *    easy band has no upper limit and the hard band no lower limit, so those two flags cannot occur.
 *
 * The result is a hint about the label and this sample. It never changes a stored difficulty.
 */

export type Difficulty = "easy" | "medium" | "hard";
export type Verdict = "match" | "easier" | "harder" | "insufficient" | "no_label";

/** Expected first-attempt full-pass share per declared difficulty, inclusive on both edges. */
export const BANDS: Record<Difficulty, { min: number; max: number }> = {
  easy: { min: 0.6, max: 1 },
  medium: { min: 0.3, max: 0.75 },
  hard: { min: 0, max: 0.5 },
};

/**
 * Fewer attempts than this: show "not enough data". At n = 20 the 95% Wilson interval is still about +/-0.2 wide at
 * worst, so only a clear gap (for example 20 of 20 on a "hard" problem) can clear a band edge; below 20 the interval
 * is wider than the 0.25-0.30 gaps between the bands' edges and a flag would mostly reflect which students showed up.
 */
export const MIN_ATTEMPTS = 20;

const Z95 = 1.959964;

/** 95% Wilson score interval for `passed` successes out of `n` (n > 0). */
export function wilson(passed: number, n: number, z = Z95): { lo: number; hi: number } {
  const p = passed / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** The verdict for an already computed interval; `bands` and `minN` are parameters so tests can sit exactly on an edge. */
export function classifyInterval(
  difficulty: string | null, interval: { lo: number; hi: number }, n: number,
  bands: Record<Difficulty, { min: number; max: number }> = BANDS, minN = MIN_ATTEMPTS,
): Verdict {
  const band = difficulty === null ? undefined : bands[difficulty as Difficulty];
  if (!band) return "no_label";
  if (n < minN) return "insufficient";
  if (interval.lo > band.max) return "easier";
  if (interval.hi < band.min) return "harder";
  return "match";
}

export type Calibration = { pass_rate: number | null; ci_low: number | null; ci_high: number | null; verdict: Verdict };

/** Pass rate, interval and verdict for one problem. With n = 0 there is no rate. */
export function calibrate(difficulty: string | null, passed: number, n: number): Calibration {
  if (n === 0) return { pass_rate: null, ci_low: null, ci_high: null, verdict: classifyInterval(difficulty, { lo: 0, hi: 1 }, 0) };
  const { lo, hi } = wilson(passed, n);
  return { pass_rate: passed / n, ci_low: lo, ci_high: hi, verdict: classifyInterval(difficulty, { lo, hi }, n) };
}

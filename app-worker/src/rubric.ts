export const RUBRIC_KEYS = ["correctness", "efficiency", "code_style", "edge_case_handling"];

/**
 * The rubric as a plain object of exactly the four keys, or an error message. Weights are non-negative integers that sum to 100:
 * the grader passes the raw edge-case weight to its LLM prompt as "points", so the scale must be the same for every exam.
 */
export function parseRubric(v: unknown): Record<string, number> | string {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length !== RUBRIC_KEYS.length
      || !RUBRIC_KEYS.every((k) => Number.isInteger(r[k]) && (r[k] as number) >= 0)) {
    return `rubric must have exactly these keys, each a non-negative integer: ${RUBRIC_KEYS.join(", ")}`;
  }
  const rubric = Object.fromEntries(RUBRIC_KEYS.map((k) => [k, r[k] as number]));
  if (Object.values(rubric).reduce((a, b) => a + b, 0) !== 100) return "rubric weights must sum to 100";
  return rubric;
}

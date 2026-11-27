import { insertCanaryRun } from "./db/canary";
import type { Env } from "./env";
import { gradeQuestion, type GradeInput } from "./grader";

/** Bump when the input below, the grader prompts or the rubric change on purpose: the canary then starts a new baseline. */
export const CANARY_INPUT_VERSION = 1;

/** One fixed submission: correct, but with an index loop a style check can comment on. Never edit without bumping the version. */
export const CANARY_INPUT: GradeInput = {
  statement: "Write sum_even(nums) that returns the sum of the even numbers in the list nums.",
  func_name: "sum_even",
  rubric: { correctness: 55, efficiency: 15, code_style: 15, edge_case_handling: 15 },
  hidden_cases: [
    { args: [[1, 2, 3, 4]], expected: 6, is_public: false },
    { args: [[]], expected: 0, is_public: false },
    { args: [[-2, 5]], expected: -2, is_public: false },
  ],
  code:
    "def sum_even(nums):\n    total = 0\n    for i in range(len(nums)):\n        if nums[i] % 2 == 0:\n            total = total + nums[i]\n    return total\n",
};

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Grades the canary once and stores the outcome. Never throws: a failure is stored as an error row. */
export async function runCanary(env: Pick<Env, "DB" | "GRADER" | "INTERNAL_TOKEN">, now: Date): Promise<void> {
  try {
    const out = await gradeQuestion(env, CANARY_INPUT);
    await insertCanaryRun(env.DB, {
      ranAt: now, inputVersion: CANARY_INPUT_VERSION, status: "ok",
      score: out.result.final_score_0_to_100, subScores: JSON.stringify(out.result.sub_scores_0_to_1),
      fingerprint: await sha256Hex(out.call_log.map((c) => c.raw_response).join("\u0000")), model: out.call_log[0]?.model ?? "",
    });
  } catch (e) {
    try {
      await insertCanaryRun(env.DB, { ranAt: now, inputVersion: CANARY_INPUT_VERSION, status: "error", error: String(e).slice(0, 300) });
    } catch (inner) {
      console.error("canary: could not store the error row", inner);
    }
  }
}

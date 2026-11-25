import type { Env } from "./env";

/** Failure talking to the Python grading Worker; `detail` is safe to show a client. */
export class GraderError extends Error {
  constructor(public status: number, public detail: string) {
    super(`grader ${status}: ${detail}`);
  }
}

export type LogEntry = {
  kind: string; schema?: string; model: string;
  system_prompt: string; user_prompt: string; raw_response: string;
};
export type GradeInput = {
  statement: string; func_name: string; rubric: Record<string, number>;
  hidden_cases: { args: unknown[]; expected: unknown; is_public: boolean }[];
  code: string;
};
export type GradeOutput = {
  result: {
    final_score_0_to_100: number;
    sub_scores_0_to_1: Record<string, number>;
    execution_result: { pass_count: number; total: number; status: string; errors?: string[] };
    check_details: unknown;
    feedback: unknown;
  };
  call_log: LogEntry[];
};

type GraderEnv = Pick<Env, "GRADER" | "INTERNAL_TOKEN">;
const FALLBACK_DETAIL = "Grading service error, please try again.";

async function post(env: GraderEnv, name: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await env.GRADER.fetch(`https://grader/api/internal/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Internal-Token": env.INTERNAL_TOKEN },
      body: JSON.stringify(body),
    });
  } catch {
    throw new GraderError(502, FALLBACK_DETAIL);
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (res.status !== 200) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new GraderError(res.status, typeof detail === "string" ? detail : FALLBACK_DETAIL);
  }
  return data;
}

export async function gradeQuestion(env: GraderEnv, input: GradeInput): Promise<GradeOutput> {
  return (await post(env, "grade", input)) as GradeOutput;
}

export async function previewProblem(env: GraderEnv, body: unknown): Promise<unknown> {
  return post(env, "preview", body);
}

export async function validateProblem(env: GraderEnv, body: unknown): Promise<void> {
  await post(env, "validate-problem", body);
}

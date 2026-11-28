import type { GraderCheckReport } from "./check_tests";
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

export type RunOutput = { status: string; message: string | null; cases: { passed: boolean; error: string | null }[] };

/** Pass/fail per public case; the Python Worker never returns the case values. */
export async function runCases(
  env: GraderEnv,
  input: { code: string; func_name: string; cases: { args: unknown[]; expected: unknown; is_public: boolean }[] },
): Promise<RunOutput> {
  return (await post(env, "run", input)) as RunOutput;
}

/** compile() only parses, so the grader's public syntax-check endpoint needs no token. */
export async function checkSyntax(env: Pick<Env, "GRADER">, code: string): Promise<unknown> {
  let res: Response;
  try {
    res = await env.GRADER.fetch("https://grader/api/syntax-check", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
    });
  } catch {
    throw new GraderError(502, FALLBACK_DETAIL);
  }
  if (res.status !== 200) throw new GraderError(res.status, FALLBACK_DETAIL);
  return res.json();
}

/** Mutation check of a test suite; the grader caps how many mutants it runs. */
export async function checkTests(env: GraderEnv, body: unknown): Promise<GraderCheckReport> {
  return (await post(env, "check-tests", body)) as GraderCheckReport;
}

export async function validateProblem(env: GraderEnv, body: unknown): Promise<void> {
  await post(env, "validate-problem", body);
}

/** The HTTP answer to give our own client for a grader failure: 400 passes the detail through, anything else is a fixed 502. */
export function toClientError(e: GraderError): { status: 400 | 502; detail: string } {
  if (e.status === 400) return { status: 400, detail: e.detail };
  return { status: 502, detail: e.status === 502 ? e.detail : FALLBACK_DETAIL };
}

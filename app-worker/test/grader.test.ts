import { describe, expect, it } from "vitest";
import { GraderError, gradeQuestion, previewProblem, validateProblem, type GradeInput } from "../src/grader";

type Call = { url: string; init: RequestInit };

function fakeEnv(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const GRADER = {
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond({ url, init });
    },
  } as unknown as Fetcher;
  return { env: { GRADER, INTERNAL_TOKEN: "tok" }, calls };
}

const INPUT: GradeInput = {
  statement: "s", func_name: "f", rubric: { correctness: 100 },
  hidden_cases: [{ args: [1], expected: 2, is_public: false }], code: "def f(x): return 2",
};
const OUTPUT = { result: { final_score_0_to_100: 80 }, call_log: [] };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("grader client", () => {
  it("sends token and JSON to /api/internal/grade", async () => {
    const { env, calls } = fakeEnv(() => json(OUTPUT));
    await gradeQuestion(env, INPUT);
    expect(calls[0].url).toBe("https://grader/api/internal/grade");
    expect(calls[0].init.method).toBe("POST");
    const h = new Headers(calls[0].init.headers);
    expect(h.get("X-Internal-Token")).toBe("tok");
    expect(h.get("content-type")).toBe("application/json");
    expect(JSON.parse(calls[0].init.body as string)).toEqual(INPUT);
  });

  it("returns the parsed output on 200", async () => {
    const { env } = fakeEnv(() => json(OUTPUT));
    expect(await gradeQuestion(env, INPUT)).toEqual(OUTPUT);
  });

  it("non-200 throws GraderError with status and detail", async () => {
    const { env } = fakeEnv(() => json({ detail: "Grading failed, please try again." }, 502));
    const err = await gradeQuestion(env, INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(GraderError);
    expect(err.status).toBe(502);
    expect(err.detail).toBe("Grading failed, please try again.");
  });

  it("a network error becomes GraderError 502", async () => {
    const { env } = fakeEnv(() => { throw new Error("boom"); });
    const err = await gradeQuestion(env, INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(GraderError);
    expect(err.status).toBe(502);
  });

  it("previewProblem posts to /api/internal/preview", async () => {
    const { env, calls } = fakeEnv(() => json({ status: "ok" }));
    expect(await previewProblem(env, { x: 1 })).toEqual({ status: "ok" });
    expect(calls[0].url).toBe("https://grader/api/internal/preview");
  });

  it("validateProblem resolves on ok and throws the 400 detail otherwise", async () => {
    const ok = fakeEnv(() => json({ ok: true }));
    await expect(validateProblem(ok.env, {})).resolves.toBeUndefined();
    const bad = fakeEnv(() => json({ detail: "Rubric weights must sum to 100, got 90" }, 400));
    const err = await validateProblem(bad.env, {}).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.detail).toContain("Rubric weights");
  });
});

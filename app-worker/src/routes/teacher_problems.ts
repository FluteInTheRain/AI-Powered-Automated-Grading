import { Hono } from "hono";
import { insertProblem, listBank, listOwnProblems, type NewProblem } from "../db/problems";
import { GraderError, previewProblem, toClientError, validateProblem } from "../grader";
import { parseRubric } from "../rubric";
import type { AppEnv } from "../index";

const IDENT = /^[A-Za-z_]\w*$/;

/** Strict shape check; the result is exactly what gets validated by the grader AND stored. */
function parseNewProblem(b: any): NewProblem | string {
  if (!b || typeof b !== "object") return "Body must be a JSON object";
  if (typeof b.statement !== "string" || !b.statement.trim()) return "statement is required";
  if (typeof b.func_name !== "string" || !IDENT.test(b.func_name)) return "func_name must be a Python identifier";
  if (!Array.isArray(b.param_names) || !b.param_names.every((x: unknown) => typeof x === "string" && IDENT.test(x))) {
    return "param_names must be a list of Python identifiers";
  }
  const rubric = parseRubric(b.rubric);
  if (typeof rubric === "string") return rubric;
  if (typeof b.reference_solution !== "string" || !b.reference_solution.trim()) return "reference_solution is required";
  if (!Array.isArray(b.test_cases) || b.test_cases.length === 0) return "At least one test case is required";
  for (const t of b.test_cases) {
    if (!t || !Array.isArray(t.args) || !("expected" in t) || typeof t.is_public !== "boolean") {
      return "Each test case needs args (list), expected, and is_public (true/false)";
    }
  }
  const starter = `def ${b.func_name}(${b.param_names.join(", ")}):\n    # TODO: your solution here\n    pass\n`;
  return {
    statement: b.statement, func_name: b.func_name, param_names: b.param_names,
    rubric,
    reference_solution: b.reference_solution,
    test_cases: b.test_cases.map((t: any) => ({ args: t.args, expected: t.expected, is_public: t.is_public })),
    starter_code: starter,
  };
}

export function teacherProblemRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get("/bank", async (c) => c.json(await listBank(c.env.DB)));
  r.get("/problems", async (c) => c.json(await listOwnProblems(c.env.DB, c.get("teacher").id)));

  r.post("/problems/preview", async (c) => {
    try {
      return c.json(await previewProblem(c.env, await c.req.json()));
    } catch (e) {
      if (!(e instanceof GraderError)) throw e;
      const { status, detail } = toClientError(e);
      return c.json({ detail }, status);
    }
  });

  r.post("/problems", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseNewProblem(body);
    if (typeof parsed === "string") return c.json({ detail: parsed }, 400);
    try {
      await validateProblem(c.env, parsed);
    } catch (e) {
      if (!(e instanceof GraderError)) throw e;
      const { status, detail } = toClientError(e);
      return c.json({ detail }, status);
    }
    return c.json({ id: await insertProblem(c.env.DB, c.get("teacher").id, parsed) });
  });
  return r;
}

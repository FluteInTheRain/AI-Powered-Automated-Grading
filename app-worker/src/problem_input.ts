import type { NewProblem } from "./db/problems";
import { parseProblemMeta } from "./problem_meta";
import { parseRubric } from "./rubric";

const IDENT = /^[A-Za-z_]\w*$/;

export type FieldError = { field: string; message: string };

const fail = (field: string, message: string): FieldError => ({ field, message });

/** Strict shape check; the result is exactly what gets validated by the grader AND stored. Shared by single create and bulk import. */
export function checkNewProblem(b: any): NewProblem | FieldError {
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("body", "Body must be a JSON object");
  if (typeof b.statement !== "string" || !b.statement.trim()) return fail("statement", "statement is required");
  if (typeof b.func_name !== "string" || !IDENT.test(b.func_name)) return fail("func_name", "func_name must be a Python identifier");
  if (!Array.isArray(b.param_names) || !b.param_names.every((x: unknown) => typeof x === "string" && IDENT.test(x))) {
    return fail("param_names", "param_names must be a list of Python identifiers");
  }
  const meta = parseProblemMeta(b);
  if (typeof meta === "string") return fail(meta.split(" ")[0], meta);
  const rubric = parseRubric(b.rubric);
  if (typeof rubric === "string") return fail("rubric", rubric);
  if (typeof b.reference_solution !== "string" || !b.reference_solution.trim()) return fail("reference_solution", "reference_solution is required");
  if (!Array.isArray(b.test_cases) || b.test_cases.length === 0) return fail("test_cases", "At least one test case is required");
  for (const t of b.test_cases) {
    if (!t || !Array.isArray(t.args) || !("expected" in t) || typeof t.is_public !== "boolean") {
      return fail("test_cases", "Each test case needs args (list), expected, and is_public (true/false)");
    }
  }
  const starter = `def ${b.func_name}(${b.param_names.join(", ")}):\n    # TODO: your solution here\n    pass\n`;
  return {
    ...meta, statement: b.statement, func_name: b.func_name, param_names: b.param_names,
    rubric,
    reference_solution: b.reference_solution,
    test_cases: b.test_cases.map((t: any) => ({ args: t.args, expected: t.expected, is_public: t.is_public })),
    starter_code: starter,
  };
}

export const isFieldError = (v: NewProblem | FieldError): v is FieldError => "field" in v && "message" in v && !("statement" in v);

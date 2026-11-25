import { newId } from "../ids";

export type TestCase = { args: unknown[]; expected: unknown; is_public: boolean };
export type Problem = {
  id: string; owner_teacher_id: string | null; visibility: "system" | "private";
  statement: string; func_name: string; param_names: string[]; rubric: Record<string, number>;
  reference_solution: string; test_cases: TestCase[]; starter_code: string; created_at: string;
};
export type NewProblem = Omit<Problem, "id" | "owner_teacher_id" | "visibility" | "created_at">;

type Row = Omit<Problem, "param_names" | "rubric" | "test_cases"> & { param_names: string; rubric: string; test_cases: string };

const toProblem = (r: Row): Problem => ({
  ...r, param_names: JSON.parse(r.param_names), rubric: JSON.parse(r.rubric), test_cases: JSON.parse(r.test_cases),
});

export async function listBank(db: D1Database) {
  const { results } = await db.prepare("SELECT * FROM problems WHERE visibility = 'system' ORDER BY id").all<Row>();
  return results.map((r) => {
    const p = toProblem(r);
    return { id: p.id, statement: p.statement, func_name: p.func_name, rubric: p.rubric };
  });
}

export async function listOwnProblems(db: D1Database, teacherId: string) {
  const { results } = await db
    .prepare("SELECT * FROM problems WHERE owner_teacher_id = ? ORDER BY created_at DESC, id")
    .bind(teacherId).all<Row>();
  return results.map((r) => {
    const p = toProblem(r);
    return { id: p.id, statement: p.statement, func_name: p.func_name, rubric: p.rubric, created_at: p.created_at };
  });
}

/** A system-bank problem, or one this teacher owns. Anything else is null (so callers answer 404). */
export async function getVisibleProblem(db: D1Database, teacherId: string, problemId: string): Promise<Problem | null> {
  const r = await db
    .prepare("SELECT * FROM problems WHERE id = ? AND (visibility = 'system' OR owner_teacher_id = ?)")
    .bind(problemId, teacherId).first<Row>();
  return r ? toProblem(r) : null;
}

export async function insertProblem(db: D1Database, teacherId: string, p: NewProblem): Promise<string> {
  const id = newId();
  await db
    .prepare(
      "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric," +
        " reference_solution, test_cases, starter_code, created_at) VALUES (?, ?, 'private', ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, teacherId, p.statement, p.func_name, JSON.stringify(p.param_names), JSON.stringify(p.rubric),
      p.reference_solution, JSON.stringify(p.test_cases), p.starter_code, new Date().toISOString())
    .run();
  return id;
}

/** Any problem by id, no ownership check: only for ids already tied to an exam the caller reached by its secret token. */
export async function getProblemById(db: D1Database, problemId: string): Promise<Problem | null> {
  const r = await db.prepare("SELECT * FROM problems WHERE id = ?").bind(problemId).first<Row>();
  return r ? toProblem(r) : null;
}

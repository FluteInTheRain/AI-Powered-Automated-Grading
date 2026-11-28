import { findSimilarPairs, MIN_TOKENS, SIMILARITY_THRESHOLD } from "../similarity";

export type ExamSimilarity = {
  threshold: number;
  min_tokens: number;
  questions: {
    problem_id: string; position: number; compared: number; skipped: number; truncated: boolean;
    pairs: { a: { attempt_id: string; student_name: string }; b: { attempt_id: string; student_name: string }; similarity: number }[];
  }[];
};

/** Read-only: one batch of two queries (D1 Free caps queries per invocation). Never writes, never touches scores. */
export async function getExamSimilarity(db: D1Database, examId: string): Promise<ExamSimilarity> {
  const [qs, subs] = await db.batch([
    db.prepare(
      "SELECT q.problem_id, q.position, p.starter_code, p.reference_solution FROM exam_questions q" +
        " JOIN problems p ON p.id = q.problem_id WHERE q.exam_id = ? ORDER BY q.position",
    ).bind(examId),
    db.prepare(
      "SELECT s.id, s.problem_id, s.code, a.id AS attempt_id, a.student_name FROM submissions s" +
        " JOIN attempts a ON a.id = s.attempt_id WHERE a.exam_id = ? ORDER BY s.submitted_at, s.id",
    ).bind(examId),
  ]);
  const byProblem = new Map<string, any[]>();
  for (const s of subs.results as any[]) {
    const l = byProblem.get(s.problem_id) ?? [];
    l.push(s);
    byProblem.set(s.problem_id, l);
  }
  const questions = (qs.results as any[]).map((q) => {
    const list = byProblem.get(q.problem_id) ?? [];
    const who = new Map(list.map((s) => [s.id as string, { attempt_id: s.attempt_id as string, student_name: s.student_name as string }]));
    const r = findSimilarPairs(list.map((s) => ({ id: s.id, code: s.code })), q.starter_code, q.reference_solution);
    return {
      problem_id: q.problem_id as string, position: q.position as number, compared: r.compared, skipped: r.skipped, truncated: r.truncated,
      pairs: r.pairs.map((p) => ({ a: who.get(p.a)!, b: who.get(p.b)!, similarity: p.similarity })),
    };
  });
  return { threshold: SIMILARITY_THRESHOLD, min_tokens: MIN_TOKENS, questions };
}

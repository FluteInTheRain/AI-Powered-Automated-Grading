import { calibrate, type Calibration } from "../difficulty";

export type ProblemDifficulty = Calibration & {
  problem_id: string; title: string | null; difficulty: string | null; n: number; mean_score: number | null;
};

type Row = { problem_id: string; title: string | null; difficulty: string | null; n: number; passed: number; score_sum: number | null };

/** Whitespace the grader's blank check (`code.trim() === starter_code.trim()`) also strips. */
const WS = "' ' || char(9, 10, 13)";

/**
 * Observed results for every problem used in the teacher's own exams, in one query.
 * An item counts when its job is done (or a Phase 1 row with a score and no job), its execution result is readable,
 * and the answer is not the untouched starter code. Per (student name, problem) only the earliest such submission
 * counts, so a student who sat the same problem in two of the teacher's exams is not counted twice.
 * Score is the latest revision (appeal adjustments included); pass/fail comes from revision 0's execution result.
 */
export async function getDifficultyCalibration(db: D1Database, teacherId: string): Promise<ProblemDifficulty[]> {
  const { results } = await db.prepare(
    "WITH scored AS (" +
      " SELECT s.problem_id, sr.score, (json_extract(r0.detail, '$.execution_result.pass_count') = json_extract(r0.detail, '$.execution_result.total')" +
      "   AND json_extract(r0.detail, '$.execution_result.total') > 0) AS passed," +
      "  ROW_NUMBER() OVER (PARTITION BY s.problem_id, coalesce(a.name_key, a.id) ORDER BY s.submitted_at, s.rowid) AS rk" +
      " FROM exams e JOIN attempts a ON a.exam_id = e.id" +
      " JOIN submissions s ON s.attempt_id = a.id JOIN problems p ON p.id = s.problem_id" +
      " LEFT JOIN grading_jobs j ON j.submission_id = s.id" +
      " JOIN score_revisions r0 ON r0.submission_id = s.id AND r0.revision = 0" +
      " JOIN score_revisions sr ON sr.submission_id = s.id AND sr.revision = (SELECT max(revision) FROM score_revisions WHERE submission_id = s.id)" +
      " WHERE e.teacher_id = ? AND (j.status IS NULL OR j.status = 'done')" +
      `  AND trim(s.code, ${WS}) <> trim(p.starter_code, ${WS})` +
      "  AND json_extract(r0.detail, '$.execution_result.total') IS NOT NULL)" +
      " SELECT p.id AS problem_id, p.title, p.difficulty, count(c.rk) AS n, coalesce(sum(c.passed), 0) AS passed, sum(c.score) AS score_sum" +
      " FROM (SELECT DISTINCT q.problem_id FROM exam_questions q JOIN exams e ON e.id = q.exam_id WHERE e.teacher_id = ?) u" +
      " JOIN problems p ON p.id = u.problem_id LEFT JOIN scored c ON c.problem_id = p.id AND c.rk = 1" +
      " GROUP BY p.id ORDER BY p.title, p.id",
  ).bind(teacherId, teacherId).all<Row>();
  return results.map((r) => ({
    problem_id: r.problem_id, title: r.title, difficulty: r.difficulty, n: r.n,
    mean_score: r.n > 0 && r.score_sum !== null ? r.score_sum / r.n : null,
    ...calibrate(r.difficulty, r.passed, r.n),
  }));
}

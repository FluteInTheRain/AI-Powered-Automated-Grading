import { computeTotal } from "../scoring";

const CRITERIA = ["correctness", "efficiency", "code_style", "edge_case_handling"] as const;
const REVIEW_BELOW = 50;

export type ExamStats = {
  attempts: number;
  /** Attempts with at least one submitted question. */
  submitted: number;
  /** Question submissions still queued or being graded. */
  grading: number;
  /** Question submissions whose grading failed. */
  failed: number;
  mean_total: number | null;
  needs_review: number;
  /** Ten bins of attempt totals: 0-9, 10-19, ... 90-100. */
  histogram: number[];
  questions: { problem_id: string; position: number; pass_rate: number | null; mean_score: number | null; criteria: Record<string, number | null> }[];
  appeals: { filed: number; decided: number; adjusted: number };
};

type QuestionRow = {
  attempt_id: string | null; problem_id: string; position: number; weight: number;
  job_status: string | null; score: number | null; pass_count: number | null; total_cases: number | null;
} & Record<string, number | string | null>;

/** Aggregates of one exam from D1: three queries (D1 Free caps queries per invocation). Only `done` jobs enter means and pass rates. */
export async function getExamStats(db: D1Database, examId: string): Promise<ExamStats> {
  const critCols = CRITERIA.map((c) => `json_extract(r0.sub_scores, '$.${c}') AS c_${c}`).join(", ");
  const [rows, attemptRow, appealRow] = await db.batch([
    db.prepare(
      "SELECT a.id AS attempt_id, q.problem_id, q.position, q.weight, j.status AS job_status, sr.score," +
        " json_extract(r0.detail, '$.execution_result.pass_count') AS pass_count," +
        ` json_extract(r0.detail, '$.execution_result.total') AS total_cases, ${critCols}` +
        " FROM exam_questions q LEFT JOIN attempts a ON a.exam_id = q.exam_id" +
        " LEFT JOIN submissions s ON s.attempt_id = a.id AND s.problem_id = q.problem_id" +
        " LEFT JOIN grading_jobs j ON j.submission_id = s.id" +
        " LEFT JOIN score_revisions sr ON sr.submission_id = s.id" +
        "   AND sr.revision = (SELECT max(revision) FROM score_revisions WHERE submission_id = s.id)" +
        " LEFT JOIN score_revisions r0 ON r0.submission_id = s.id AND r0.revision = 0" +
        " WHERE q.exam_id = ? ORDER BY q.position, a.started_at, a.rowid",
    ).bind(examId),
    db.prepare("SELECT count(*) AS n FROM attempts WHERE exam_id = ?").bind(examId),
    db.prepare(
      "SELECT count(*) AS filed, coalesce(sum(p.status IN ('upheld','rejected','adjusted')), 0) AS decided," +
        " coalesce(sum(p.status = 'adjusted'), 0) AS adjusted FROM appeals p" +
        " JOIN submissions s ON s.id = p.submission_id JOIN attempts a ON a.id = s.attempt_id WHERE a.exam_id = ?",
    ).bind(examId),
  ]);
  const data = rows.results as QuestionRow[];
  const attempts = (attemptRow.results[0] as { n: number }).n;
  const ap = appealRow.results[0] as { filed: number; decided: number; adjusted: number };

  const byAttempt = new Map<string, QuestionRow[]>();
  let grading = 0, failed = 0;
  for (const r of data) {
    if (r.attempt_id === null || r.job_status === null) continue;
    if (r.job_status === "queued" || r.job_status === "grading") grading++;
    if (r.job_status === "failed") failed++;
    byAttempt.set(r.attempt_id, [...(byAttempt.get(r.attempt_id) ?? []), r]);
  }

  const totals: number[] = [];
  let needsReview = 0;
  const histogram = Array(10).fill(0);
  const weights = new Map(data.map((r) => [r.problem_id, r.weight]));
  for (const rs of byAttempt.values()) {
    const complete = rs.length === weights.size && rs.every((r) => r.score !== null);
    const total = complete ? computeTotal(rs.map((r) => ({ weight: r.weight, score: r.score as number }))) : null;
    if (total !== null) {
      totals.push(total);
      histogram[Math.min(Math.floor(total / 10), 9)]++;
    }
    if (rs.some((r) => r.job_status === "failed") || (total !== null && total < REVIEW_BELOW)) needsReview++;
  }

  const questions = [...weights.keys()].map((problemId) => {
    const qs = data.filter((r) => r.problem_id === problemId);
    const done = qs.filter((r) => r.job_status === "done" && r.score !== null);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const criteria: Record<string, number | null> = {};
    for (const c of CRITERIA) criteria[c] = mean(done.map((r) => r[`c_${c}`]).filter((v): v is number => typeof v === "number"));
    const passed = done.filter((r) => r.total_cases !== null && r.total_cases > 0 && r.pass_count === r.total_cases).length;
    return {
      problem_id: problemId, position: qs[0].position,
      pass_rate: done.length ? passed / done.length : null,
      mean_score: mean(done.map((r) => r.score as number)),
      criteria,
    };
  });

  return {
    attempts, submitted: byAttempt.size, grading, failed,
    mean_total: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null,
    needs_review: needsReview, histogram, questions,
    appeals: { filed: ap.filed, decided: ap.decided, adjusted: ap.adjusted },
  };
}

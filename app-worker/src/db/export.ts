import { computeTotal } from "../scoring";

export const DIMENSIONS = [
  { key: "correctness", label: "Đúng sai" },
  { key: "efficiency", label: "Hiệu năng" },
  { key: "code_style", label: "Phong cách code" },
  { key: "edge_case_handling", label: "Trường hợp biên" },
] as const;

type Row = {
  attempt_id: string; student_name: string; started_at: string; position: number; weight: number;
  score: number | null; sub_scores: string | null; submitted_at: string | null;
};

export type ExportAttempt = {
  student_name: string; started_at: string; submitted_at: string | null;
  scores: (number | null)[]; total: number | null; dimensions: (number | null)[];
};

/**
 * Everything the CSV needs in ONE query (D1 Free caps queries per invocation). Scores and sub-scores come from the LATEST
 * revision, so teacher adjustments from appeals are included (an adjustment copies the AI's sub-scores forward).
 */
export async function exportRows(db: D1Database, examId: string): Promise<{ questionCount: number; attempts: ExportAttempt[] }> {
  const { results } = await db
    .prepare(
      "SELECT a.id AS attempt_id, a.student_name, a.started_at, q.position, q.weight, sr.score, sr.sub_scores, s.submitted_at" +
        " FROM attempts a JOIN exam_questions q ON q.exam_id = a.exam_id" +
        " LEFT JOIN submissions s ON s.attempt_id = a.id AND s.problem_id = q.problem_id" +
        " LEFT JOIN score_revisions sr ON sr.submission_id = s.id" +
        "   AND sr.revision = (SELECT max(revision) FROM score_revisions WHERE submission_id = s.id)" +
        " WHERE a.exam_id = ? ORDER BY a.started_at, a.rowid, q.position",
    ).bind(examId).all<Row>();
  const by = new Map<string, Row[]>();
  for (const r of results) by.set(r.attempt_id, [...(by.get(r.attempt_id) ?? []), r]);
  const attempts = [...by.values()].map((rows) => {
    const scored = rows.filter((r) => r.score !== null);
    // Dimension score: question-weighted mean of the 0-1 sub-score as a percentage; blank until every question is graded.
    const dimensions = DIMENSIONS.map((d) => {
      if (scored.length !== rows.length) return null;
      const items = rows.map((r) => ({ weight: r.weight, score: (JSON.parse(r.sub_scores ?? "{}")[d.key] ?? NaN) * 100 }));
      return items.some((i) => Number.isNaN(i.score)) ? null : computeTotal(items);
    });
    const submitted = rows.map((r) => r.submitted_at).filter((t): t is string => t !== null).sort();
    return {
      student_name: rows[0].student_name, started_at: rows[0].started_at,
      submitted_at: submitted.length ? submitted[submitted.length - 1] : null,
      scores: rows.map((r) => r.score),
      total: scored.length === rows.length ? computeTotal(rows.map((r) => ({ weight: r.weight, score: r.score as number }))) : null,
      dimensions,
    };
  });
  const questionCount = attempts.length ? attempts[0].scores.length : 0;
  return { questionCount, attempts };
}

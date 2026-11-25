import { newId, newReceiptCode } from "../ids";
import type { GradeOutput } from "../grader";
import type { Problem } from "./problems";
import { computeTotal } from "../scoring";


export type StudentExam = {
  id: string; title: string; deadline: string | null; student_token: string; time_limit_seconds: number;
  questions: { problem_id: string; position: number; weight: number; statement: string; starter_code: string; test_cases: string }[];
};

export async function getExamByStudentToken(db: D1Database, token: string) {
  const exam = await db
    .prepare("SELECT id, title, deadline, student_token, time_limit_seconds FROM exams WHERE student_token = ?")
    .bind(token).first<Omit<StudentExam, "questions">>();
  if (!exam) return null;
  const { results } = await db
    .prepare(
      "SELECT q.problem_id, q.position, q.weight, p.statement, p.starter_code, p.test_cases FROM exam_questions q" +
        " JOIN problems p ON p.id = q.problem_id WHERE q.exam_id = ? ORDER BY q.position",
    ).bind(exam.id).all<StudentExam["questions"][number]>();
  return { ...exam, questions: results } as StudentExam;
}

export async function createAttempt(db: D1Database, examId: string, studentName: string, startedAt: Date) {
  for (let i = 0; i < 5; i++) {
    const id = newId();
    const receipt = newReceiptCode();
    try {
      await db
        .prepare("INSERT INTO attempts (id, exam_id, student_name, receipt_code, started_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, examId, studentName, receipt, startedAt.toISOString()).run();
      return { attempt_id: id, receipt_code: receipt };
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e; // receipt collision: draw another code
    }
  }
  throw new Error("could not allocate a receipt code");
}

export async function attemptInExam(db: D1Database, attemptId: string, examId: string) {
  return db.prepare("SELECT id, started_at FROM attempts WHERE id = ? AND exam_id = ?").bind(attemptId, examId).first<{ id: string; started_at: string }>();
}

export async function submissionExists(db: D1Database, attemptId: string, problemId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS x FROM submissions WHERE attempt_id = ? AND problem_id = ?").bind(attemptId, problemId).first());
}

export class AlreadySubmitted extends Error {}

/** Submission + revision 0 + grading logs in one atomic batch; the UNIQUE(attempt, problem) constraint decides races. */
export async function saveGraded(
  db: D1Database,
  a: { attemptId: string; problem: Problem; code: string; out: GradeOutput },
): Promise<void> {
  const sid = newId();
  const now = new Date().toISOString();
  const r = a.out.result;
  const stmts = [
    db.prepare("INSERT INTO submissions (id, attempt_id, problem_id, code, submitted_at) VALUES (?, ?, ?, ?, ?)")
      .bind(sid, a.attemptId, a.problem.id, a.code, now),
    db.prepare(
      "INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, reason, created_at)" +
        " VALUES (?, ?, 0, 'ai', ?, ?, ?, 'pipeline', NULL, ?)",
    ).bind(newId(), sid, r.final_score_0_to_100, JSON.stringify(r.sub_scores_0_to_1), JSON.stringify(r), now),
    ...a.out.call_log.map((e, i) =>
      db.prepare(
        "INSERT INTO grading_logs (id, submission_id, call_index, kind, schema_name, model, system_prompt, user_prompt, raw_response, created_at)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(newId(), sid, i, e.kind, e.schema ?? null, e.model, e.system_prompt, e.user_prompt, e.raw_response, now)),
  ];
  try {
    await db.batch(stmts);
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new AlreadySubmitted();
    throw e;
  }
}

type ScoreRow = { problem_id: string; weight: number; score: number | null; ai_detail: string | null };

/** Per-question latest score (and the AI feedback) of one attempt, in exam order, plus the weighted total. */
export async function attemptScores(db: D1Database, examId: string, attemptId: string) {
  const { results } = await db
    .prepare(
      "SELECT q.problem_id, q.weight, sr.score," +
        " (SELECT detail FROM score_revisions WHERE submission_id = s.id AND revision = 0) AS ai_detail" +
        " FROM exam_questions q" +
        " LEFT JOIN submissions s ON s.attempt_id = ? AND s.problem_id = q.problem_id" +
        " LEFT JOIN score_revisions sr ON sr.submission_id = s.id" +
        "   AND sr.revision = (SELECT max(revision) FROM score_revisions WHERE submission_id = s.id)" +
        " WHERE q.exam_id = ? ORDER BY q.position",
    ).bind(attemptId, examId).all<ScoreRow>();
  const questions = results.map((r) => ({
    problem_id: r.problem_id,
    score: r.score,
    feedback: r.ai_detail ? (JSON.parse(r.ai_detail).feedback ?? null) : null,
  }));
  const all = results.every((r) => r.score !== null);
  const total = all ? computeTotal(results.map((r) => ({ weight: r.weight, score: r.score as number }))) : null;
  return { questions, total };
}

export async function attemptByReceipt(db: D1Database, examId: string, receipt: string) {
  return db
    .prepare("SELECT id, student_name, started_at FROM attempts WHERE exam_id = ? AND receipt_code = ?")
    .bind(examId, receipt).first<{ id: string; student_name: string; started_at: string }>();
}

export async function listAttempts(db: D1Database, examId: string) {
  const { results } = await db
    .prepare("SELECT id, student_name, started_at FROM attempts WHERE exam_id = ? ORDER BY started_at, rowid")
    .bind(examId).all<{ id: string; student_name: string; started_at: string }>();
  return results;
}

type ResultRow = {
  attempt_id: string; student_name: string; started_at: string; problem_id: string; weight: number; score: number | null;
};

/** Every attempt of an exam with its per-question latest score and weighted total, in ONE query (D1 Free caps queries per invocation). */
export async function listResults(db: D1Database, examId: string) {
  const { results } = await db
    .prepare(
      "SELECT a.id AS attempt_id, a.student_name, a.started_at, q.problem_id, q.weight, sr.score" +
        " FROM attempts a JOIN exam_questions q ON q.exam_id = a.exam_id" +
        " LEFT JOIN submissions s ON s.attempt_id = a.id AND s.problem_id = q.problem_id" +
        " LEFT JOIN score_revisions sr ON sr.submission_id = s.id" +
        "   AND sr.revision = (SELECT max(revision) FROM score_revisions WHERE submission_id = s.id)" +
        " WHERE a.exam_id = ? ORDER BY a.started_at, a.rowid, q.position",
    ).bind(examId).all<ResultRow>();
  const byAttempt = new Map<string, { attempt_id: string; student_name: string; started_at: string; rows: ResultRow[] }>();
  for (const r of results) {
    const e = byAttempt.get(r.attempt_id) ?? { attempt_id: r.attempt_id, student_name: r.student_name, started_at: r.started_at, rows: [] };
    e.rows.push(r);
    byAttempt.set(r.attempt_id, e);
  }
  return [...byAttempt.values()].map((e) => ({
    attempt_id: e.attempt_id, student_name: e.student_name, started_at: e.started_at,
    questions: e.rows.map((r) => ({ problem_id: r.problem_id, score: r.score })),
    total: e.rows.every((r) => r.score !== null)
      ? computeTotal(e.rows.map((r) => ({ weight: r.weight, score: r.score as number }))) : null,
  }));
}

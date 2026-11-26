import { newId, newReceiptCode } from "../ids";
import { computeTotal } from "../scoring";


export type StudentExam = {
  id: string; title: string; deadline: string | null; student_token: string; time_limit_seconds: number;
  questions: { problem_id: string; position: number; weight: number; statement: string; starter_code: string; test_cases: string; rubric: string }[];
};

export async function getExamByStudentToken(db: D1Database, token: string) {
  const exam = await db
    .prepare("SELECT id, title, deadline, student_token, time_limit_seconds FROM exams WHERE student_token = ?")
    .bind(token).first<Omit<StudentExam, "questions">>();
  if (!exam) return null;
  const { results } = await db
    .prepare(
      "SELECT q.problem_id, q.position, q.weight, p.statement, p.starter_code, p.test_cases, p.rubric FROM exam_questions q" +
        " JOIN problems p ON p.id = q.problem_id WHERE q.exam_id = ? ORDER BY q.position",
    ).bind(exam.id).all<StudentExam["questions"][number]>();
  return { ...exam, questions: results } as StudentExam;
}

export class NameTaken extends Error {}

export async function createAttempt(db: D1Database, examId: string, studentName: string, startedAt: Date) {
  const nameKey = studentName.trim().toLowerCase();
  for (let i = 0; i < 5; i++) {
    const id = newId();
    const receipt = newReceiptCode();
    try {
      await db
        .prepare("INSERT INTO attempts (id, exam_id, student_name, name_key, receipt_code, started_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, examId, studentName, nameKey, receipt, startedAt.toISOString()).run();
      return { attempt_id: id, receipt_code: receipt };
    } catch (e) {
      const msg = String(e);
      if (msg.includes("name_key")) throw new NameTaken(); // same name already used in this exam
      if (!msg.includes("UNIQUE")) throw e; // a receipt collision just draws another code
    }
  }
  throw new Error("could not allocate a receipt code");
}

/** Undo a just-created attempt whose clock could not be started, so the name is free again. */
export async function deleteAttempt(db: D1Database, attemptId: string): Promise<void> {
  await db.prepare("DELETE FROM attempts WHERE id = ?").bind(attemptId).run();
}

export async function attemptInExam(db: D1Database, attemptId: string, examId: string) {
  return db
    .prepare("SELECT id, student_name, receipt_code, started_at FROM attempts WHERE id = ? AND exam_id = ?")
    .bind(attemptId, examId)
    .first<{ id: string; student_name: string; receipt_code: string; started_at: string }>();
}

export async function submissionExists(db: D1Database, attemptId: string, problemId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS x FROM submissions WHERE attempt_id = ? AND problem_id = ?").bind(attemptId, problemId).first());
}

export class AlreadySubmitted extends Error {}

/** Phase 1 submissions have no job row but do have a score: they are done. */
function questionStatus(jobStatus: string | null, score: number | null, hasSubmission: number): QuestionStatus {
  return (jobStatus ?? (score !== null ? "done" : hasSubmission ? "queued" : "none")) as QuestionStatus;
}

type ScoreRow = { problem_id: string; weight: number; score: number | null; ai_detail: string | null; job_status: string | null; has_submission: number };

/** Per-question latest score (and the AI feedback) of one attempt, in exam order, plus the weighted total. */
export async function attemptScores(db: D1Database, examId: string, attemptId: string) {
  const { results } = await db
    .prepare(
      "SELECT q.problem_id, q.weight, sr.score, j.status AS job_status, (s.id IS NOT NULL) AS has_submission," +
        " (SELECT detail FROM score_revisions WHERE submission_id = s.id AND revision = 0) AS ai_detail" +
        " FROM exam_questions q" +
        " LEFT JOIN submissions s ON s.attempt_id = ? AND s.problem_id = q.problem_id" +
        " LEFT JOIN grading_jobs j ON j.submission_id = s.id" +
        " LEFT JOIN score_revisions sr ON sr.submission_id = s.id" +
        "   AND sr.revision = (SELECT max(revision) FROM score_revisions WHERE submission_id = s.id)" +
        " WHERE q.exam_id = ? ORDER BY q.position",
    ).bind(attemptId, examId).all<ScoreRow>();
  const questions = results.map((r) => ({
    problem_id: r.problem_id,
    score: r.score,
    status: questionStatus(r.job_status, r.score, r.has_submission),
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
  job_status: string | null; has_submission: number;
};

/** Every attempt of an exam with its per-question latest score and weighted total, in ONE query (D1 Free caps queries per invocation). */
export async function listResults(db: D1Database, examId: string) {
  const { results } = await db
    .prepare(
      "SELECT a.id AS attempt_id, a.student_name, a.started_at, q.problem_id, q.weight, sr.score," +
        " j.status AS job_status, (s.id IS NOT NULL) AS has_submission" +
        " FROM attempts a JOIN exam_questions q ON q.exam_id = a.exam_id" +
        " LEFT JOIN submissions s ON s.attempt_id = a.id AND s.problem_id = q.problem_id" +
        " LEFT JOIN grading_jobs j ON j.submission_id = s.id" +
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
    questions: e.rows.map((r) => ({ problem_id: r.problem_id, score: r.score, status: questionStatus(r.job_status, r.score, r.has_submission) })),
    total: e.rows.every((r) => r.score !== null)
      ? computeTotal(e.rows.map((r) => ({ weight: r.weight, score: r.score as number }))) : null,
  }));
}

export type QuestionStatus = "none" | "queued" | "grading" | "done" | "failed";

/** Job status per problem of one attempt (problems with no submission are absent). */
export async function attemptJobStatuses(db: D1Database, attemptId: string): Promise<Map<string, QuestionStatus>> {
  const { results } = await db
    .prepare("SELECT s.problem_id, j.status FROM submissions s JOIN grading_jobs j ON j.submission_id = s.id WHERE s.attempt_id = ?")
    .bind(attemptId).all<{ problem_id: string; status: QuestionStatus }>();
  return new Map(results.map((r) => [r.problem_id, r.status]));
}

export async function findSubmissionId(db: D1Database, attemptId: string, problemId: string): Promise<string | null> {
  const r = await db.prepare("SELECT id FROM submissions WHERE attempt_id = ? AND problem_id = ?").bind(attemptId, problemId).first<{ id: string }>();
  return r?.id ?? null;
}

/** The student-facing result of a graded question: latest score plus the AI detail (counts, never case values). */
export async function gradedResult(db: D1Database, submissionId: string) {
  const row = await db
    .prepare(
      "SELECT (SELECT score FROM score_revisions WHERE submission_id = ?1 ORDER BY revision DESC LIMIT 1) AS score," +
        " (SELECT detail FROM score_revisions WHERE submission_id = ?1 AND revision = 0) AS detail",
    ).bind(submissionId).first<{ score: number | null; detail: string | null }>();
  if (!row || row.score === null || !row.detail) return null;
  const d = JSON.parse(row.detail);
  return {
    score: row.score, sub_scores: d.sub_scores_0_to_1,
    tests: { passed: d.execution_result.pass_count, total: d.execution_result.total },
    feedback: d.feedback ?? null,
  };
}

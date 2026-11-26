import { newId } from "../ids";
import { AlreadySubmitted } from "./attempts";
import { getProblemById, type Problem } from "./problems";

export type JobStatus = "queued" | "grading" | "done" | "failed";
export type Job = {
  submission_id: string; status: JobStatus; attempts: number;
  error: string | null; audit_key: string | null; updated_at: string;
};
export type SubmissionRow = { id: string; attempt_id: string; problem_id: string; code: string; submitted_at: string };

/** Submission + its queued job in one batch; the UNIQUE(attempt, problem) constraint decides races. */
export async function insertSubmissionWithJob(
  db: D1Database,
  a: { attemptId: string; problemId: string; code: string },
): Promise<string> {
  const sid = newId();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare("INSERT INTO submissions (id, attempt_id, problem_id, code, submitted_at) VALUES (?, ?, ?, ?, ?)")
        .bind(sid, a.attemptId, a.problemId, a.code, now),
      db.prepare("INSERT INTO grading_jobs (submission_id, status, attempts, updated_at) VALUES (?, 'queued', 0, ?)").bind(sid, now),
    ]);
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new AlreadySubmitted();
    throw e;
  }
  return sid;
}

export async function getJob(db: D1Database, submissionId: string): Promise<Job | null> {
  return db.prepare("SELECT * FROM grading_jobs WHERE submission_id = ?").bind(submissionId).first<Job>();
}

export async function setJobStatus(
  db: D1Database,
  submissionId: string,
  status: JobStatus,
  extra: { error?: string; auditKey?: string; bumpAttempts?: boolean; resetAttempts?: boolean } = {},
): Promise<void> {
  await db
    .prepare(
      "UPDATE grading_jobs SET status = ?, error = COALESCE(?, error), audit_key = COALESCE(?, audit_key)," +
        " attempts = CASE WHEN ? THEN 0 ELSE attempts + ? END, updated_at = ? WHERE submission_id = ?",
    )
    .bind(status, extra.error ?? null, extra.auditKey ?? null, extra.resetAttempts ? 1 : 0, extra.bumpAttempts ? 1 : 0,
      new Date().toISOString(), submissionId)
    .run();
}

export async function getSubmissionBundle(
  db: D1Database,
  submissionId: string,
): Promise<{ submission: SubmissionRow; problem: Problem } | null> {
  const submission = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(submissionId).first<SubmissionRow>();
  if (!submission) return null;
  const problem = await getProblemById(db, submission.problem_id);
  return problem ? { submission, problem } : null;
}

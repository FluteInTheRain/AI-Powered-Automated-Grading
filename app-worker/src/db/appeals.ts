import { newId } from "../ids";

export type AppealStatus = "open" | "under_review" | "upheld" | "adjusted" | "rejected" | "expired";
export type Decision = "upheld" | "rejected" | "adjusted";

/** An `open` appeal older than this many days is expired by the daily cron. */
export const APPEAL_EXPIRY_DAYS = 14;

export class AppealExists extends Error {}

const PENDING = "('open','under_review')";

export async function createAppeal(db: D1Database, a: { submissionId: string; message: string; now: Date }): Promise<string> {
  const id = newId();
  try {
    await db
      .prepare("INSERT INTO appeals (id, submission_id, message, status, created_at) VALUES (?, ?, ?, 'open', ?)")
      .bind(id, a.submissionId, a.message, a.now.toISOString()).run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new AppealExists();
    throw e;
  }
  return id;
}

/** The submission of one question and whether it already has a score (an appeal needs one). */
export async function submissionForAppeal(db: D1Database, attemptId: string, problemId: string): Promise<{ id: string; graded: boolean } | null> {
  const r = await db
    .prepare(
      "SELECT s.id, EXISTS (SELECT 1 FROM score_revisions WHERE submission_id = s.id) AS graded" +
        " FROM submissions s WHERE s.attempt_id = ? AND s.problem_id = ?",
    ).bind(attemptId, problemId).first<{ id: string; graded: number }>();
  return r ? { id: r.id, graded: r.graded === 1 } : null;
}

export type StudentAppeal = {
  problem_id: string; status: AppealStatus; message: string; decision_note: string | null;
  created_at: string; decided_at: string | null; score: number;
};

/** The appeals of one attempt with the question's current score, in ONE query. */
export async function listAppealsForAttempt(db: D1Database, attemptId: string): Promise<StudentAppeal[]> {
  const { results } = await db
    .prepare(
      "SELECT s.problem_id, a.status, a.message, a.decision_note, a.created_at, a.decided_at," +
        " (SELECT score FROM score_revisions WHERE submission_id = s.id ORDER BY revision DESC LIMIT 1) AS score" +
        " FROM appeals a JOIN submissions s ON s.id = a.submission_id WHERE s.attempt_id = ? ORDER BY a.created_at, a.rowid",
    ).bind(attemptId).all<StudentAppeal>();
  return results;
}

export type ExamAppeal = { id: string; student_name: string; problem_id: string; status: AppealStatus; created_at: string };

export async function listExamAppeals(db: D1Database, examId: string): Promise<ExamAppeal[]> {
  const { results } = await db
    .prepare(
      "SELECT a.id, t.student_name, s.problem_id, a.status, a.created_at FROM appeals a" +
        " JOIN submissions s ON s.id = a.submission_id JOIN attempts t ON t.id = s.attempt_id" +
        " WHERE t.exam_id = ? ORDER BY a.created_at DESC, a.rowid DESC",
    ).bind(examId).all<ExamAppeal>();
  return results;
}

export type Revision = { revision: number; source: string; score: number; author: string; reason: string | null; created_at: string; detail: string | null };
export type AppealDetail = {
  id: string; exam_id: string; teacher_id: string; student_name: string; problem_id: string; submission_id: string;
  status: AppealStatus; message: string; decision_note: string | null; decided_by: string | null;
  created_at: string; decided_at: string | null; code: string; audit_key: string | null; revisions: Revision[];
};

/** One appeal with its submission, owner and score history (two queries), or null. */
export async function getAppealDetail(db: D1Database, appealId: string): Promise<AppealDetail | null> {
  const row = await db
    .prepare(
      "SELECT a.id, t.exam_id, e.teacher_id, t.student_name, s.problem_id, s.id AS submission_id, a.status, a.message," +
        " a.decision_note, a.decided_by, a.created_at, a.decided_at, s.code, j.audit_key FROM appeals a" +
        " JOIN submissions s ON s.id = a.submission_id JOIN attempts t ON t.id = s.attempt_id JOIN exams e ON e.id = t.exam_id" +
        " LEFT JOIN grading_jobs j ON j.submission_id = s.id WHERE a.id = ?",
    ).bind(appealId).first<Omit<AppealDetail, "revisions">>();
  if (!row) return null;
  const { results } = await db
    .prepare("SELECT revision, source, score, author, reason, created_at, detail FROM score_revisions WHERE submission_id = ? ORDER BY revision")
    .bind(row.submission_id).all<Revision>();
  return { ...row, revisions: results };
}

/** open -> under_review. True only when this call made the change. */
export async function markUnderReview(db: D1Database, appealId: string): Promise<boolean> {
  const r = await db.prepare("UPDATE appeals SET status = 'under_review' WHERE id = ? AND status = 'open'").bind(appealId).run();
  return r.meta.changes > 0;
}

/**
 * Decides a pending appeal in ONE batch (a D1 transaction). `adjusted` first appends a teacher revision that copies the
 * latest one's detail; the revision insert and the status update carry the same "still pending" guard, so of two
 * concurrent decisions exactly one writes anything.
 */
export async function decideAppeal(
  db: D1Database,
  d: { id: string; decision: Decision; note: string; score?: number; teacherEmail: string; now: Date },
): Promise<"ok" | "already_decided"> {
  const now = d.now.toISOString();
  const statements: D1PreparedStatement[] = [];
  if (d.decision === "adjusted") {
    statements.push(
      db.prepare(
        "INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, reason, created_at)" +
          " SELECT ?1, sr.submission_id, sr.revision + 1, 'teacher', ?2, sr.sub_scores, sr.detail, ?3, ?4, ?5 FROM score_revisions sr" +
          " WHERE sr.submission_id = (SELECT submission_id FROM appeals WHERE id = ?6)" +
          " AND sr.revision = (SELECT max(revision) FROM score_revisions WHERE submission_id = sr.submission_id)" +
          ` AND EXISTS (SELECT 1 FROM appeals WHERE id = ?6 AND status IN ${PENDING})`,
      ).bind(newId(), d.score, d.teacherEmail, d.note, now, d.id),
    );
  }
  statements.push(
    db.prepare(
      `UPDATE appeals SET status = ?, decision_note = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status IN ${PENDING}`,
    ).bind(d.decision, d.note, d.teacherEmail, now, d.id),
  );
  const results = await db.batch(statements);
  return results[results.length - 1].meta.changes > 0 ? "ok" : "already_decided";
}

/** Daily cron: `open` appeals created before the cutoff become `expired`. Returns how many. */
export async function expireStaleAppeals(db: D1Database, cutoff: Date): Promise<number> {
  const r = await db.prepare("UPDATE appeals SET status = 'expired' WHERE status = 'open' AND created_at < ?").bind(cutoff.toISOString()).run();
  return r.meta.changes;
}

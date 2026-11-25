import { newId, newToken } from "../ids";

export type ExamRow = {
  id: string; teacher_id: string; title: string; student_token: string;
  deadline: string | null; time_limit_seconds: number; created_at: string;
};
export type QuestionRow = { exam_id: string; problem_id: string; position: number; weight: number };

export async function insertExam(
  db: D1Database,
  e: { teacherId: string; title: string; deadline: string | null; timeLimitSeconds: number; questions: { problem_id: string; weight: number }[] },
): Promise<{ id: string; student_token: string }> {
  const id = newId();
  const token = newToken();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      "INSERT INTO exams (id, teacher_id, title, student_token, deadline, time_limit_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, e.teacherId, e.title, token, e.deadline, e.timeLimitSeconds, now),
    ...e.questions.map((q, i) =>
      db.prepare("INSERT INTO exam_questions (exam_id, problem_id, position, weight) VALUES (?, ?, ?, ?)")
        .bind(id, q.problem_id, i, q.weight)),
  ]);
  return { id, student_token: token };
}

/** The teacher's own exam, or null (so callers answer 404 for someone else's exam). */
export async function getOwnExam(db: D1Database, teacherId: string, examId: string): Promise<ExamRow | null> {
  return db.prepare("SELECT * FROM exams WHERE id = ? AND teacher_id = ?").bind(examId, teacherId).first<ExamRow>();
}

export async function listOwnExams(db: D1Database, teacherId: string): Promise<ExamRow[]> {
  // rowid breaks ties between exams created in the same millisecond.
  const { results } = await db
    .prepare("SELECT * FROM exams WHERE teacher_id = ? ORDER BY created_at DESC, rowid DESC")
    .bind(teacherId).all<ExamRow>();
  return results;
}

export async function listExamQuestions(db: D1Database, examId: string) {
  const { results } = await db
    .prepare(
      "SELECT q.problem_id, q.position, q.weight, p.statement FROM exam_questions q" +
        " JOIN problems p ON p.id = q.problem_id WHERE q.exam_id = ? ORDER BY q.position",
    ).bind(examId).all<{ problem_id: string; position: number; weight: number; statement: string }>();
  return results;
}

export async function setDeadline(db: D1Database, examId: string, deadline: string | null): Promise<void> {
  await db.prepare("UPDATE exams SET deadline = ? WHERE id = ?").bind(deadline, examId).run();
}

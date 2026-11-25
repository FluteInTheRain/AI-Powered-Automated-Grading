import { Hono } from "hono";
import { getVisibleProblem } from "../db/problems";
import { getOwnExam, insertExam, listExamQuestions, listOwnExams, setDeadline, type ExamRow } from "../db/exams";
import type { AppEnv } from "../index";

const DEFAULT_TIME_LIMIT_SECONDS = 600;

const view = (e: ExamRow) => ({
  id: e.id, title: e.title, student_token: e.student_token, student_path: `/exam/${e.student_token}`,
  deadline: e.deadline, time_limit_seconds: e.time_limit_seconds, created_at: e.created_at,
});

/** ISO string for a valid date input, null for absent/null, undefined for garbage. */
function parseDeadline(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function teacherExamRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post("/exams", async (c) => {
    const b: any = await c.req.json().catch(() => null);
    const bad = (detail: string) => c.json({ detail }, 400);
    if (!b || typeof b.title !== "string" || !b.title.trim() || b.title.length > 120) return bad("title must be 1-120 characters");
    const deadline = parseDeadline(b.deadline);
    if (deadline === undefined) return bad("deadline must be an ISO date");
    const limit = b.time_limit_seconds ?? DEFAULT_TIME_LIMIT_SECONDS;
    if (!Number.isInteger(limit) || limit <= 0) return bad("time_limit_seconds must be a positive integer");
    if (!Array.isArray(b.questions) || b.questions.length === 0) return bad("At least one question is required");
    const questions: { problem_id: string; weight: number }[] = [];
    for (const q of b.questions) {
      const weight = q?.weight ?? 1;
      if (typeof q?.problem_id !== "string") return bad("Each question needs a problem_id");
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) return bad("weight must be a positive number");
      questions.push({ problem_id: q.problem_id, weight });
    }
    if (new Set(questions.map((q) => q.problem_id)).size !== questions.length) return bad("A problem can appear only once");

    const teacher = c.get("teacher");
    for (const q of questions) {
      if (!(await getVisibleProblem(c.env.DB, teacher.id, q.problem_id))) {
        return c.json({ detail: `Unknown problem_id: ${q.problem_id}` }, 404);
      }
    }
    const { id, student_token } = await insertExam(c.env.DB, {
      teacherId: teacher.id, title: b.title.trim(), deadline, timeLimitSeconds: limit, questions,
    });
    return c.json({ id, student_token, student_path: `/exam/${student_token}` });
  });

  r.get("/exams", async (c) => c.json((await listOwnExams(c.env.DB, c.get("teacher").id)).map(view)));

  r.get("/exams/:id", async (c) => {
    const exam = await getOwnExam(c.env.DB, c.get("teacher").id, c.req.param("id"));
    if (!exam) return c.json({ detail: "Unknown exam" }, 404);
    const questions = (await listExamQuestions(c.env.DB, exam.id)).map((q) => ({
      problem_id: q.problem_id, position: q.position, weight: q.weight,
      statement_excerpt: q.statement.length <= 120 ? q.statement : q.statement.slice(0, 120) + "…",
    }));
    return c.json({ ...view(exam), questions });
  });

  r.patch("/exams/:id", async (c) => {
    const exam = await getOwnExam(c.env.DB, c.get("teacher").id, c.req.param("id"));
    if (!exam) return c.json({ detail: "Unknown exam" }, 404);
    const b: any = await c.req.json().catch(() => null);
    const deadline = parseDeadline(b?.deadline);
    if (deadline === undefined) return c.json({ detail: "deadline must be an ISO date or null" }, 400);
    await setDeadline(c.env.DB, exam.id, deadline);
    return c.json({ ...view(exam), deadline });
  });
  return r;
}

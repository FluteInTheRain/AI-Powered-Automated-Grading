import { Hono } from "hono";
import { getVisibleProblem } from "../db/problems";
import { getOwnExam, insertExam, listExamQuestions, listOwnExams, setDeadline, type ExamRow } from "../db/exams";
import { listResults } from "../db/attempts";
import { getExamStats } from "../db/stats";
import { DIMENSIONS, exportRows } from "../db/export";
import { toCsv } from "../csv";
import { getExamSimilarity } from "../db/similarity";
import { getSettings } from "../db/teachers";
import type { AppEnv } from "../index";
import { parseRubric } from "../rubric";

const DEFAULT_TIME_LIMIT_SECONDS = 600;
// The one-shot submit writes two rows per question in one D1 batch; the Free plan caps queries per invocation.
const MAX_QUESTIONS = 20;

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
    // Only at creation: PATCH may set a past time on purpose, to close an exam now.
    if (deadline !== null && new Date(deadline).getTime() <= Date.now()) return bad("deadline is already in the past");
    const limit = b.time_limit_seconds ?? DEFAULT_TIME_LIMIT_SECONDS;
    if (!Number.isInteger(limit) || limit <= 0) return bad("time_limit_seconds must be a positive integer");
    if (!Array.isArray(b.questions) || b.questions.length === 0) return bad("At least one question is required");
    if (b.questions.length > MAX_QUESTIONS) return bad(`An exam can have at most ${MAX_QUESTIONS} questions`);
    let rubric: Record<string, number> | null = null;
    if (b.rubric !== undefined && b.rubric !== null) {
      const parsed = parseRubric(b.rubric);
      if (typeof parsed === "string") return bad(parsed);
      rubric = parsed;
    }
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
    // No explicit weights: the teacher's default from Settings, else null (each problem keeps its own rubric).
    if (rubric === null) rubric = (await getSettings(c.env.DB, teacher.id)).default_rubric ?? null;
    const { id, student_token } = await insertExam(c.env.DB, {
      teacherId: teacher.id, title: b.title.trim(), deadline, timeLimitSeconds: limit, rubric, questions,
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
    return c.json({ ...view(exam), rubric: exam.rubric ? JSON.parse(exam.rubric) : null, questions });
  });

  r.get("/exams/:id/results", async (c) => {
    const exam = await getOwnExam(c.env.DB, c.get("teacher").id, c.req.param("id"));
    if (!exam) return c.json({ detail: "Unknown exam" }, 404);
    const rows = await listResults(c.env.DB, exam.id);
    return c.json(rows);
  });

  // Token-free: the exam is found by its own id, behind Access like every /api/teacher/* route, and only for its owner.
  r.get("/exams/:id/export.csv", async (c) => {
    const exam = await getOwnExam(c.env.DB, c.get("teacher").id, c.req.param("id"));
    if (!exam) return c.json({ detail: "Unknown exam" }, 404);
    const { questionCount, attempts } = await exportRows(c.env.DB, exam.id);
    const header = [
      "Học viên", ...Array.from({ length: questionCount }, (_, i) => `Câu ${i + 1}`), "Tổng điểm",
      ...DIMENSIONS.map((d) => d.label), "Bắt đầu lúc", "Nộp lúc",
    ];
    const rows = attempts.map((a) => [a.student_name, ...a.scores, a.total, ...a.dimensions, a.started_at, a.submitted_at]);
    return new Response(toCsv([header, ...rows]), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ket-qua-${exam.id}.csv"`,
        "cache-control": "no-store",
      },
    });
  });

  r.get("/exams/:id/stats", async (c) => {
    const exam = await getOwnExam(c.env.DB, c.get("teacher").id, c.req.param("id"));
    if (!exam) return c.json({ detail: "Unknown exam" }, 404);
    return c.json(await getExamStats(c.env.DB, exam.id));
  });

  // PR-E3: a signal for the teacher to look again, never a verdict; read-only, changes no score.
  r.get("/exams/:id/similarity", async (c) => {
    const exam = await getOwnExam(c.env.DB, c.get("teacher").id, c.req.param("id"));
    if (!exam) return c.json({ detail: "Unknown exam" }, 404);
    return c.json(await getExamSimilarity(c.env.DB, exam.id));
  });

  r.patch("/exams/:id", async (c) => {
    const exam = await getOwnExam(c.env.DB, c.get("teacher").id, c.req.param("id"));
    if (!exam) return c.json({ detail: "Unknown exam" }, 404);
    const b: any = await c.req.json().catch(() => null);
    if (!b || typeof b !== "object" || !("deadline" in b)) return c.json({ detail: "deadline is required (ISO date or null)" }, 400);
    const deadline = parseDeadline(b.deadline);
    if (deadline === undefined) return c.json({ detail: "deadline must be an ISO date or null" }, 400);
    await setDeadline(c.env.DB, exam.id, deadline);
    return c.json({ ...view(exam), deadline });
  });
  return r;
}

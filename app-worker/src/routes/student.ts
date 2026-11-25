import { Hono } from "hono";
import {
  AlreadySubmitted, attemptByReceipt, attemptInExam, attemptScores, createAttempt, getExamByStudentToken,
  saveGraded, submissionExists,
} from "../db/attempts";
import type { TestCase } from "../db/problems";
import { getProblemById } from "../db/problems";
import { GraderError, gradeQuestion, toClientError } from "../grader";
import type { AppEnv } from "../index";

const MAX_NAME = 100;
const MAX_CODE = 20_000;
const GRACE_SECONDS = 10; // slack for network latency on the last submit

export function studentRoutes(now: () => Date): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const closed = (deadline: string | null) => deadline !== null && new Date(deadline).getTime() <= now().getTime();
  const notFound = (c: any, what: string) => c.json({ detail: `Unknown ${what}` }, 404);

  r.get("/:token", async (c) => {
    const exam = await getExamByStudentToken(c.env.DB, c.req.param("token"));
    if (!exam) return notFound(c, "exam link");
    return c.json({
      title: exam.title, deadline: exam.deadline,
      questions: exam.questions.map((q) => ({
        problem_id: q.problem_id, position: q.position, weight: q.weight, statement: q.statement,
        starter_code: q.starter_code,
        public_cases: (JSON.parse(q.test_cases) as TestCase[]).filter((t) => t.is_public).map((t) => ({ args: t.args, expected: t.expected })),
      })),
    });
  });

  r.post("/:token/attempts", async (c) => {
    const exam = await getExamByStudentToken(c.env.DB, c.req.param("token"));
    if (!exam) return notFound(c, "exam link");
    const b: any = await c.req.json().catch(() => null);
    const name = typeof b?.student_name === "string" ? b.student_name.trim() : "";
    if (!name || name.length > MAX_NAME) return c.json({ detail: "student_name must be 1-100 characters" }, 400);
    if (closed(exam.deadline)) return c.json({ detail: "This exam is closed" }, 403);
    return c.json(await createAttempt(c.env.DB, exam.id, name, now()));
  });

  r.post("/:token/attempts/:attemptId/questions/:problemId/submit", async (c) => {
    const { token, attemptId, problemId } = c.req.param();
    const exam = await getExamByStudentToken(c.env.DB, token);
    if (!exam) return notFound(c, "exam link");
    const attempt = await attemptInExam(c.env.DB, attemptId, exam.id);
    if (!attempt) return notFound(c, "attempt");
    if (!exam.questions.some((q) => q.problem_id === problemId)) return notFound(c, "question");
    const b: any = await c.req.json().catch(() => null);
    if (typeof b?.code !== "string" || b.code.length === 0 || b.code.length > MAX_CODE) {
      return c.json({ detail: "code must be 1-20000 characters" }, 400);
    }
    if (closed(exam.deadline)) return c.json({ detail: "This exam is closed" }, 403);
    if (now().getTime() > Date.parse(attempt.started_at) + (exam.time_limit_seconds + GRACE_SECONDS) * 1000) {
      return c.json({ detail: "Time limit exceeded" }, 403);
    }
    if (await submissionExists(c.env.DB, attemptId, problemId)) return c.json({ detail: "Already submitted" }, 409);

    const problem = await getProblemById(c.env.DB, problemId);
    if (!problem) return notFound(c, "question");
    let out;
    try {
      out = await gradeQuestion(c.env, {
        statement: problem.statement, func_name: problem.func_name, rubric: problem.rubric,
        hidden_cases: problem.test_cases.filter((t) => !t.is_public), code: b.code,
      });
    } catch (e) {
      if (!(e instanceof GraderError)) throw e;
      const { status, detail } = toClientError(e);
      return c.json({ detail }, status);
    }
    try {
      await saveGraded(c.env.DB, { attemptId, problem, code: b.code, out });
    } catch (e) {
      if (e instanceof AlreadySubmitted) return c.json({ detail: "Already submitted" }, 409);
      throw e;
    }
    const res = out.result;
    return c.json({
      problem_id: problemId, score: res.final_score_0_to_100, sub_scores: res.sub_scores_0_to_1,
      // Counts only: failed-case details would reveal hidden inputs and expected values.
      tests: { passed: res.execution_result.pass_count, total: res.execution_result.total },
      feedback: res.feedback,
    });
  });

  r.get("/:token/attempts/by-receipt/:receipt", async (c) => {
    const exam = await getExamByStudentToken(c.env.DB, c.req.param("token"));
    if (!exam) return notFound(c, "exam link");
    const attempt = await attemptByReceipt(c.env.DB, exam.id, c.req.param("receipt"));
    if (!attempt) return notFound(c, "receipt code");
    const s = await attemptScores(c.env.DB, exam.id, attempt.id);
    return c.json({ student_name: attempt.student_name, ...s });
  });
  return r;
}

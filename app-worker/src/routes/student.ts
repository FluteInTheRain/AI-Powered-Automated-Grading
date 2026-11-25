import type { Context } from "hono";
import { Hono } from "hono";
import {
  AlreadySubmitted, attemptByReceipt, attemptInExam, attemptScores, createAttempt, getExamByStudentToken,
  saveGraded, submissionExists, type StudentExam,
} from "../db/attempts";
import type { TestCase } from "../db/problems";
import { getProblemById } from "../db/problems";
import { GraderError, gradeQuestion, runCases, toClientError } from "../grader";
import type { AppEnv } from "../index";

const MAX_NAME = 100;
const MAX_CODE = 20_000;
const GRACE_SECONDS = 10; // slack for network latency on the last submit

type Ctx = Context<AppEnv>;
type QuestionContext = { exam: StudentExam; attemptId: string; problemId: string; code: string };

export function studentRoutes(now: () => Date): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const closed = (deadline: string | null) => deadline !== null && new Date(deadline).getTime() <= now().getTime();
  const notFound = (c: Ctx, what: string) => c.json({ detail: `Unknown ${what}` }, 404);
  const casesOf = (q: { test_cases: string }) => JSON.parse(q.test_cases) as TestCase[];

  /** Shared by run and submit: token, attempt, question, code, closed and time-limit checks, in that order. */
  async function questionContext(c: Ctx): Promise<Response | QuestionContext> {
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
    return { exam, attemptId, problemId, code: b.code };
  }

  r.get("/:token", async (c) => {
    const exam = await getExamByStudentToken(c.env.DB, c.req.param("token"));
    if (!exam) return notFound(c, "exam link");
    return c.json({
      title: exam.title, deadline: exam.deadline, time_limit_seconds: exam.time_limit_seconds,
      is_closed: closed(exam.deadline),
      questions: exam.questions.map((q) => {
        const cases = casesOf(q);
        return {
          problem_id: q.problem_id, position: q.position, weight: q.weight, statement: q.statement,
          starter_code: q.starter_code, rubric: JSON.parse(q.rubric),
          // Counts only: values of public or hidden cases are never sent to students.
          public_case_count: cases.filter((t) => t.is_public).length,
          hidden_case_count: cases.filter((t) => !t.is_public).length,
        };
      }),
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

  r.post("/:token/attempts/:attemptId/questions/:problemId/run", async (c) => {
    const q = await questionContext(c);
    if (q instanceof Response) return q;
    const question = q.exam.questions.find((x) => x.problem_id === q.problemId)!;
    const problem = await getProblemById(c.env.DB, q.problemId);
    if (!problem) return notFound(c, "question");
    try {
      return c.json(await runCases(c.env, {
        code: q.code, func_name: problem.func_name, cases: casesOf(question).filter((t) => t.is_public),
      }));
    } catch (e) {
      if (!(e instanceof GraderError)) throw e;
      const { status, detail } = toClientError(e);
      return c.json({ detail }, status);
    }
  });

  r.post("/:token/attempts/:attemptId/questions/:problemId/submit", async (c) => {
    const q = await questionContext(c);
    if (q instanceof Response) return q;
    const { attemptId, problemId, code } = q;
    if (await submissionExists(c.env.DB, attemptId, problemId)) return c.json({ detail: "Already submitted" }, 409);

    const problem = await getProblemById(c.env.DB, problemId);
    if (!problem) return notFound(c, "question");
    let out;
    try {
      out = await gradeQuestion(c.env, {
        statement: problem.statement, func_name: problem.func_name, rubric: problem.rubric,
        hidden_cases: problem.test_cases.filter((t) => !t.is_public), code,
      });
    } catch (e) {
      if (!(e instanceof GraderError)) throw e;
      const { status, detail } = toClientError(e);
      return c.json({ detail }, status);
    }
    try {
      await saveGraded(c.env.DB, { attemptId, problem, code, out });
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

import type { Context } from "hono";
import { Hono } from "hono";
import {
  AlreadySubmitted, NameTaken, attemptByReceipt, attemptInExam, attemptJobStatuses, attemptScores, createAttempt, deleteAttempt, findSubmissionId,
  getExamByStudentToken, gradedResult, submissionExists, type QuestionStatus, type StudentExam,
} from "../db/attempts";
import { getJob, insertSubmissionWithJob, setJobStatus } from "../db/jobs";
import type { TestCase } from "../db/problems";
import { getProblemById } from "../db/problems";
import type { Env } from "../env";
import { isPermanentError } from "../jobs";
import { GraderError, runCases, toClientError } from "../grader";
import { TOO_MANY, allow, clientIp } from "../limits";
import type { TurnstileVerifier } from "../turnstile";
import type { AppEnv } from "../index";

const MAX_NAME = 100;
const MAX_CODE = 20_000;
const STUCK_AFTER_MS = 120_000; // a queued or grading job older than this is treated as lost and may be retried
const DEADLINE_GRACE_MS = 10_000; // run and submit may land this long after the exam deadline (clock and network slack)

type Ctx = Context<AppEnv>;
type QuestionContext = { exam: StudentExam; attemptId: string; problemId: string; code: string };

const attemptStub = (env: Env, attemptId: string) => env.ATTEMPT.get(env.ATTEMPT.idFromName(attemptId));

export function studentRoutes(now: () => Date, verify: TurnstileVerifier): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const closed = (deadline: string | null, graceMs = 0) =>
    deadline !== null && new Date(deadline).getTime() + graceMs <= now().getTime();
  const isStuck = (job: { status: string; updated_at: string }) =>
    (job.status === "queued" || job.status === "grading") && now().getTime() - Date.parse(job.updated_at) > STUCK_AFTER_MS;
  const notFound = (c: Ctx, what: string) => c.json({ detail: `Unknown ${what}` }, 404);
  const casesOf = (q: { test_cases: string }) => JSON.parse(q.test_cases) as TestCase[];

  const questionView = (q: StudentExam["questions"][number]) => {
    const cases = casesOf(q);
    return {
      problem_id: q.problem_id, position: q.position, weight: q.weight, statement: q.statement,
      starter_code: q.starter_code, rubric: JSON.parse(q.rubric),
      // Counts only: values of public or hidden cases are never sent to students.
      public_case_count: cases.filter((t) => t.is_public).length,
      hidden_case_count: cases.filter((t) => !t.is_public).length,
    };
  };

  /** Seconds left: the attempt clock, capped by the exam's absolute deadline. */
  const remainingSeconds = (exam: StudentExam, clockSeconds: number) =>
    exam.deadline === null
      ? clockSeconds
      : Math.max(0, Math.min(clockSeconds, Math.floor((new Date(exam.deadline).getTime() - now().getTime()) / 1000)));

  /** Token, attempt and question must all belong together. */
  async function attemptContext(c: Ctx): Promise<Response | { exam: StudentExam; attemptId: string; problemId: string }> {
    const { token, attemptId, problemId } = c.req.param();
    const exam = await getExamByStudentToken(c.env.DB, token);
    if (!exam) return notFound(c, "exam link");
    if (!(await attemptInExam(c.env.DB, attemptId, exam.id))) return notFound(c, "attempt");
    if (!exam.questions.some((q) => q.problem_id === problemId)) return notFound(c, "question");
    return { exam, attemptId, problemId };
  }

  /** Shared by run and submit: the above plus code, closed and time-limit checks (the clock is the Durable Object's). */
  async function questionContext(c: Ctx): Promise<Response | QuestionContext> {
    const base = await attemptContext(c);
    if (base instanceof Response) return base;
    const b: any = await c.req.json().catch(() => null);
    if (typeof b?.code !== "string" || b.code.length === 0 || b.code.length > MAX_CODE) {
      return c.json({ detail: "code must be 1-20000 characters" }, 400);
    }
    if (closed(base.exam.deadline, DEADLINE_GRACE_MS)) return c.json({ detail: "This exam is closed" }, 403);
    const clock = await attemptStub(c.env, base.attemptId).check(now().getTime());
    if (!clock.running) return c.json({ detail: "Time limit exceeded" }, 403);
    return { ...base, code: b.code };
  }

  async function enqueue(c: Ctx, submissionId: string): Promise<Response | null> {
    try {
      await c.env.GRADING_QUEUE.send({ submission_id: submissionId });
      return null;
    } catch {
      return c.json({ detail: "Could not queue grading, please retry." }, 503);
    }
  }

  r.get("/:token", async (c) => {
    const exam = await getExamByStudentToken(c.env.DB, c.req.param("token"));
    if (!exam) return notFound(c, "exam link");
    return c.json({
      title: exam.title, deadline: exam.deadline, time_limit_seconds: exam.time_limit_seconds,
      is_closed: closed(exam.deadline), question_count: exam.questions.length,
      turnstile_site_key: c.env.TURNSTILE_SITE_KEY ?? "",
    });
  });

  r.post("/:token/attempts", async (c) => {
    if (!(await allow(c.env.RL_START, clientIp(c.req)))) return c.json(TOO_MANY, 429);
    const exam = await getExamByStudentToken(c.env.DB, c.req.param("token"));
    if (!exam) return notFound(c, "exam link");
    const b: any = await c.req.json().catch(() => null);
    const name = typeof b?.student_name === "string" ? b.student_name.trim() : "";
    if (!name || name.length > MAX_NAME) return c.json({ detail: "student_name must be 1-100 characters" }, 400);
    if (closed(exam.deadline)) return c.json({ detail: "This exam is closed" }, 403);
    if (!(await verify(c.env, b?.turnstile_token, c.req.header("CF-Connecting-IP") ?? null))) {
      return c.json({ detail: "Please complete the verification." }, 400);
    }
    let attempt;
    try {
      attempt = await createAttempt(c.env.DB, exam.id, name, now());
    } catch (e) {
      if (e instanceof NameTaken) {
        return c.json({ detail: "This name is already used in this exam. If it was you, continue in the browser where you started, or look up your score with your receipt code." }, 409);
      }
      throw e;
    }
    const stub = attemptStub(c.env, attempt.attempt_id);
    let clock;
    try {
      await stub.begin(exam.time_limit_seconds, now().getTime());
      clock = await stub.check(now().getTime());
    } catch (e) {
      await deleteAttempt(c.env.DB, attempt.attempt_id); // an attempt without a clock could never act
      throw e;
    }
    return c.json({ ...attempt, remaining_seconds: remainingSeconds(exam, clock.remainingSeconds), questions: exam.questions.map(questionView) });
  });

  r.get("/:token/attempts/by-receipt/:receipt", async (c) => {
    const exam = await getExamByStudentToken(c.env.DB, c.req.param("token"));
    if (!exam) return notFound(c, "exam link");
    const attempt = await attemptByReceipt(c.env.DB, exam.id, c.req.param("receipt"));
    if (!attempt) return notFound(c, "receipt code");
    return c.json({ student_name: attempt.student_name, ...(await attemptScores(c.env.DB, exam.id, attempt.id)) });
  });

  /** Resume after a refresh: the attempt id is the secret the browser kept. */
  r.get("/:token/attempts/:attemptId", async (c) => {
    const exam = await getExamByStudentToken(c.env.DB, c.req.param("token"));
    if (!exam) return notFound(c, "exam link");
    const attempt = await attemptInExam(c.env.DB, c.req.param("attemptId"), exam.id);
    if (!attempt) return notFound(c, "attempt");
    const clock = await attemptStub(c.env, attempt.id).check(now().getTime());
    const statuses = await attemptJobStatuses(c.env.DB, attempt.id);
    return c.json({
      student_name: attempt.student_name, receipt_code: attempt.receipt_code,
      remaining_seconds: remainingSeconds(exam, clock.remainingSeconds),
      questions: exam.questions.map((q) => ({ ...questionView(q), status: (statuses.get(q.problem_id) ?? "none") as QuestionStatus })),
    });
  });

  r.post("/:token/attempts/:attemptId/questions/:problemId/run", async (c) => {
    if (!(await allow(c.env.RL_ACTION, c.req.param("attemptId")))) return c.json(TOO_MANY, 429);
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
    if (!(await allow(c.env.RL_ACTION, c.req.param("attemptId")))) return c.json(TOO_MANY, 429);
    const q = await questionContext(c);
    if (q instanceof Response) return q;
    const { attemptId, problemId, code } = q;
    if (await submissionExists(c.env.DB, attemptId, problemId)) return c.json({ detail: "Already submitted" }, 409);
    // One submit per question at a time. After a stored submission the claim no longer matters (a resubmit is a 409
    // anyway); if storing fails the claim is released, and a claim left by a crash expires on its own.
    const stub = attemptStub(c.env, attemptId);
    if (!(await stub.claim(problemId, now().getTime()))) {
      return c.json({ detail: "A submission for this question is already in progress" }, 409);
    }
    let submissionId: string;
    try {
      submissionId = await insertSubmissionWithJob(c.env.DB, { attemptId, problemId, code });
    } catch (e) {
      if (e instanceof AlreadySubmitted) return c.json({ detail: "Already submitted" }, 409);
      await stub.release(problemId);
      throw e;
    }
    const failure = await enqueue(c, submissionId);
    if (failure) return failure; // the stored job stays queued; /retry re-sends it
    return c.json({ status: "queued" }, 202);
  });

  r.get("/:token/attempts/:attemptId/questions/:problemId/status", async (c) => {
    const ctx = await attemptContext(c);
    if (ctx instanceof Response) return ctx;
    const sid = await findSubmissionId(c.env.DB, ctx.attemptId, ctx.problemId);
    const job = sid ? await getJob(c.env.DB, sid) : null;
    if (!sid || !job) return c.json({ status: "none" });
    if (job.status === "done") {
      const result = await gradedResult(c.env.DB, sid);
      return c.json({ status: "done", ...(result ?? {}) });
    }
    if (job.status === "failed") return c.json({ status: "failed", error: job.error, retryable: !isPermanentError(job.error) });
    return c.json(isStuck(job) ? { status: job.status, stuck: true } : { status: job.status });
  });

  /** Grade again after a failure, or recover a job whose queue message was lost. */
  r.post("/:token/attempts/:attemptId/questions/:problemId/retry", async (c) => {
    if (!(await allow(c.env.RL_ACTION, c.req.param("attemptId")))) return c.json(TOO_MANY, 429);
    const ctx = await attemptContext(c);
    if (ctx instanceof Response) return ctx;
    const sid = await findSubmissionId(c.env.DB, ctx.attemptId, ctx.problemId);
    const job = sid ? await getJob(c.env.DB, sid) : null;
    const retryable = !!job && ((job.status === "failed" && !isPermanentError(job.error)) || isStuck(job));
    if (!sid || !job || !retryable) return c.json({ detail: "Nothing to retry" }, 409);
    await setJobStatus(c.env.DB, sid, "queued", { resetAttempts: true });
    const failure = await enqueue(c, sid);
    if (failure) return failure;
    return c.json({ status: "queued" }, 202);
  });

  return r;
}

import { Hono } from "hono";
import { attemptByReceipt, getExamByStudentToken } from "../db/attempts";
import { AppealExists, createAppeal, listAppealsForAttempt, submissionForAppeal } from "../db/appeals";
import { TOO_MANY, allow, clientIp } from "../limits";
import type { TurnstileVerifier } from "../turnstile";
import type { AppEnv } from "../index";

const MAX_MESSAGE = 1000;

/** A student files and follows appeals with the exam link plus the receipt code of their attempt. */
export function studentAppealRoutes(now: () => Date, verify: TurnstileVerifier): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const base = "/:token/attempts/by-receipt/:receipt/appeals";

  r.post(base, async (c) => {
    const { token, receipt } = c.req.param();
    // Two keys: one receipt cannot be hammered from many places, and one address cannot walk through many receipts.
    if (!(await allow(c.env.RL_ACTION, `appeal-receipt:${receipt}`))) return c.json(TOO_MANY, 429);
    if (!(await allow(c.env.RL_ACTION, `appeal-ip:${clientIp(c.req)}`))) return c.json(TOO_MANY, 429);
    const exam = await getExamByStudentToken(c.env.DB, token);
    if (!exam) return c.json({ detail: "Unknown exam link" }, 404);
    const b: any = await c.req.json().catch(() => null);
    const message = typeof b?.message === "string" ? b.message.trim() : "";
    if (!message || message.length > MAX_MESSAGE || typeof b?.problem_id !== "string") {
      return c.json({ detail: `message must be 1-${MAX_MESSAGE} characters and problem_id is required` }, 400);
    }
    if (!(await verify(c.env, b.turnstile_token, c.req.header("CF-Connecting-IP") ?? null))) {
      return c.json({ detail: "Please complete the verification." }, 400);
    }
    const attempt = await attemptByReceipt(c.env.DB, exam.id, receipt);
    if (!attempt) return c.json({ detail: "Unknown receipt code" }, 404);
    if (!exam.questions.some((q) => q.problem_id === b.problem_id)) return c.json({ detail: "Unknown question" }, 404);
    const sub = await submissionForAppeal(c.env.DB, attempt.id, b.problem_id);
    if (!sub?.graded) return c.json({ detail: "Only a graded question can be appealed." }, 409);
    try {
      await createAppeal(c.env.DB, { submissionId: sub.id, message, now: now() });
    } catch (e) {
      if (e instanceof AppealExists) return c.json({ detail: "This question already has an appeal." }, 409);
      throw e;
    }
    return c.json({ status: "open" }, 201);
  });

  r.get(base, async (c) => {
    const exam = await getExamByStudentToken(c.env.DB, c.req.param("token"));
    if (!exam) return c.json({ detail: "Unknown exam link" }, 404);
    const attempt = await attemptByReceipt(c.env.DB, exam.id, c.req.param("receipt"));
    if (!attempt) return c.json({ detail: "Unknown receipt code" }, 404);
    return c.json(await listAppealsForAttempt(c.env.DB, attempt.id));
  });

  return r;
}

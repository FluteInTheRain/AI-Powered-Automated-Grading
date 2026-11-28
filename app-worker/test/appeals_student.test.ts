import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { decideAppeal } from "../src/db/appeals";
import { seedGradedAttempt } from "./appeals_fixture";
import { client } from "./helpers";

type Seed = Awaited<ReturnType<typeof seedGradedAttempt>>;
const path = (s: Seed, receipt = s.receipt, token = s.token) => `/api/exam/${token}/attempts/by-receipt/${receipt}/appeals`;
const file = (s: Seed, body: Record<string, unknown> = {}, c = s.call) =>
  c("POST", path(s), { body: { problem_id: s.problemId, message: "Please recheck", turnstile_token: "t", ...body } });
const appealCount = async () => (await env.DB.prepare("SELECT count(*) AS n FROM appeals").first<any>()).n;

describe("filing an appeal", () => {
  it("stores it open and lists it with the current score", async () => {
    const s = await seedGradedAttempt();
    const r = await file(s);
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ status: "open" });
    const list = await s.call("GET", path(s));
    expect(list.status).toBe(200);
    expect(list.json).toEqual([expect.objectContaining({ problem_id: s.problemId, status: "open", message: "Please recheck", decision_note: null, score: 60 })]);
  });

  it("a second appeal for the same question is a 409", async () => {
    const s = await seedGradedAttempt();
    expect((await file(s)).status).toBe(201);
    expect((await file(s, { message: "again" })).status).toBe(409);
  });

  it("an unknown receipt, or one from another exam, is a 404", async () => {
    const a = await seedGradedAttempt();
    const b = await seedGradedAttempt();
    expect((await a.call("POST", path(a, "NOSUCHCODE"), { body: { problem_id: a.problemId, message: "m", turnstile_token: "t" } })).status).toBe(404);
    expect((await a.call("POST", path(a, b.receipt), { body: { problem_id: a.problemId, message: "m", turnstile_token: "t" } })).status).toBe(404);
    expect((await a.call("GET", path(a, b.receipt))).status).toBe(404);
  });

  it("a problem that is not in the exam is a 404 and a question of another exam is not reachable", async () => {
    const a = await seedGradedAttempt();
    const b = await seedGradedAttempt();
    expect((await file(a, { problem_id: b.problemId })).status).toBe(404);
    expect((await file(a, { problem_id: "bank:missing" })).status).toBe(404);
  });

  it("a question that is not graded yet is a 409", async () => {
    const s = await seedGradedAttempt({ graded: false });
    const before = await appealCount();
    expect((await file(s)).status).toBe(409);
    expect(await appealCount()).toBe(before);
  });

  it.each([["empty", ""], ["blank", "   \n "], ["too long", "x".repeat(1001)], ["not a string", 5]])("a %s message is a 400", async (_n, message) => {
    const s = await seedGradedAttempt();
    expect((await file(s, { message })).status).toBe(400);
  });

  it("a message of exactly 1000 characters is accepted", async () => {
    const s = await seedGradedAttempt();
    expect((await file(s, { message: "x".repeat(1000) })).status).toBe(201);
  });

  it("a failed Turnstile check is a 400 and stores nothing", async () => {
    const s = await seedGradedAttempt();
    const c = client(s.grader.binding, undefined, undefined, { GRADING_QUEUE: s.queue.binding, turnstile: async () => false });
    const before = await appealCount();
    expect((await file(s, {}, c)).status).toBe(400);
    expect(await appealCount()).toBe(before);
  });

  it("the rate limit answers 429", async () => {
    const s = await seedGradedAttempt();
    const c = client(s.grader.binding, undefined, undefined, { GRADING_QUEUE: s.queue.binding, RL_ACTION: { limit: async () => ({ success: false }) } });
    expect((await file(s, {}, c)).status).toBe(429);
  });

  it("is limited per receipt and per client IP, each under its own key, before any other work", async () => {
    const s = await seedGradedAttempt();
    const keys: string[] = [];
    const record = (deny: string) => ({ limit: async ({ key }: { key: string }) => { keys.push(key); return { success: !key.startsWith(deny) }; } });
    const before = await appealCount();
    const headers = { "CF-Connecting-IP": "203.0.113.9" };
    const post = (c: typeof s.call) => c("POST", path(s), { headers, body: { problem_id: s.problemId, message: "m", turnstile_token: "t" } });

    const byIp = client(s.grader.binding, undefined, undefined, { GRADING_QUEUE: s.queue.binding, RL_ACTION: record("appeal-ip:") });
    expect((await post(byIp)).status).toBe(429);
    expect(keys).toEqual([`appeal-receipt:${s.receipt}`, "appeal-ip:203.0.113.9"]);

    keys.length = 0;
    const byReceipt = client(s.grader.binding, undefined, undefined, { GRADING_QUEUE: s.queue.binding, RL_ACTION: record("appeal-receipt:") });
    expect((await post(byReceipt)).status).toBe(429);
    expect(keys).toEqual([`appeal-receipt:${s.receipt}`]);
    expect(await appealCount()).toBe(before);
  });
});

describe("looking an appeal up", () => {
  it("shows the teacher's note and the adjusted score once decided", async () => {
    const s = await seedGradedAttempt();
    await file(s);
    const id = (await env.DB.prepare("SELECT id FROM appeals WHERE submission_id = ?").bind(s.submissionId).first<any>()).id;
    await decideAppeal(env.DB, { id, decision: "adjusted", note: "Edge case was fine", score: 85, teacherEmail: "t@x.com", now: new Date() });
    const list = await s.call("GET", path(s));
    expect(list.json).toEqual([expect.objectContaining({ status: "adjusted", decision_note: "Edge case was fine", score: 85 })]);
  });

  it("is an empty list when nothing was filed", async () => {
    const s = await seedGradedAttempt();
    expect((await s.call("GET", path(s))).json).toEqual([]);
  });
});

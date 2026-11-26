import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { allow } from "../src/limits";
import { client, fakeGrader, fakeQueue, jsonRes } from "./helpers";

const limiter = (success: boolean) => {
  const keys: string[] = [];
  return { keys, binding: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success }; } } as unknown as RateLimit };
};
const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<any>()).n;
const grader = fakeGrader(() => jsonRes({ ok: true, status: "ran", message: null, cases: [] }));
const q = fakeQueue();
const allowAll = client(grader.binding, undefined, undefined, { GRADING_QUEUE: q.binding });

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric, reference_solution, test_cases, starter_code, created_at)" +
      " VALUES ('bank:lp', NULL, 'system', 's','f','[]','{\"correctness\":100}','r','[{\"args\":[1],\"expected\":1,\"is_public\":false}]','c','2026-01-01T00:00:00Z')").run();
});

async function exam(as: string) {
  const r = await allowAll("POST", "/api/teacher/exams", { as, body: { title: "T", questions: [{ problem_id: "bank:lp" }] } });
  return r.json.student_token as string;
}

describe("allow", () => {
  it("maps the binding outcome to a boolean and passes the key", async () => {
    const yes = limiter(true);
    const no = limiter(false);
    expect(await allow(yes.binding, "k1")).toBe(true);
    expect(await allow(no.binding, "k2")).toBe(false);
    expect([...yes.keys, ...no.keys]).toEqual(["k1", "k2"]);
  });
});

describe("rate limited student endpoints", () => {
  it("start is 429 when the limiter denies, creates no attempt, and keys by the client IP", async () => {
    const token = await exam("l1@x.com");
    const deny = limiter(false);
    const c = client(grader.binding, undefined, undefined, { GRADING_QUEUE: q.binding, RL_START: deny.binding });
    const before = await count("attempts");
    const r = await c("POST", `/api/exam/${token}/attempts`, { body: { student_name: "Fast" }, headers: { "CF-Connecting-IP": "203.0.113.9" } });
    expect(r.status).toBe(429);
    expect(r.json.detail).toContain("Too many requests");
    expect(await count("attempts")).toBe(before);
    expect(deny.keys).toEqual(["203.0.113.9"]);
  });

  it("syntax check is 429 when denied and never reaches the grader", async () => {
    const deny = limiter(false);
    const calls = grader.calls.length;
    const c = client(grader.binding, undefined, undefined, { RL_SYNTAX: deny.binding });
    const r = await c("POST", "/api/syntax-check", { body: { code: "x = 1" }, headers: { "CF-Connecting-IP": "203.0.113.7" } });
    expect(r.status).toBe(429);
    expect(grader.calls.length).toBe(calls);
    expect(deny.keys).toEqual(["203.0.113.7"]);
  });

  it("run, submit and retry are 429 when denied, keyed by the attempt id, before any other work", async () => {
    const token = await exam("l2@x.com");
    const a = (await allowAll("POST", `/api/exam/${token}/attempts`, { body: { student_name: "Slow" } })).json;
    const deny = limiter(false);
    const c = client(grader.binding, undefined, undefined, { GRADING_QUEUE: q.binding, RL_ACTION: deny.binding });
    const base = `/api/exam/${token}/attempts/${a.attempt_id}/questions/bank:lp`;
    const subs = await count("submissions");
    expect((await c("POST", `${base}/run`, { body: { code: "x" } })).status).toBe(429);
    expect((await c("POST", `/api/exam/${token}/attempts/${a.attempt_id}/submit`, { body: { answers: {} } })).status).toBe(429);
    expect((await c("POST", `${base}/retry`)).status).toBe(429);
    expect(deny.keys).toEqual([a.attempt_id, a.attempt_id, a.attempt_id]);
    expect(await count("submissions")).toBe(subs);
  });

  it("allowed requests still work", async () => {
    const token = await exam("l3@x.com");
    expect((await allowAll("POST", `/api/exam/${token}/attempts`, { body: { student_name: "Fine" } })).status).toBe(200);
    expect((await allowAll("POST", "/api/syntax-check", { body: { code: "x = 1" } })).status).toBe(200);
  });
});

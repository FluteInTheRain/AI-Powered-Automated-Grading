import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyTurnstile } from "../src/turnstile";
import { client, fakeGrader, fakeQueue, jsonRes } from "./helpers";

const HOST = "teacher-app.khangnguyen.workers.dev";
const cfg = { TURNSTILE_SECRET: "s3cret", TURNSTILE_HOSTNAMES: `${HOST}, other.example` };
const fetchReturning = (body: unknown, calls: { url: string; init: RequestInit }[] = []) =>
  (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body)); }) as unknown as typeof fetch;

describe("verifyTurnstile", () => {
  it("is true for a success on an allowed hostname and posts secret, response and ip", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    expect(await verifyTurnstile(cfg, "tok", "1.2.3.4", fetchReturning({ success: true, hostname: HOST }, calls))).toBe(true);
    expect(calls[0].url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = calls[0].init.body as URLSearchParams;
    expect([body.get("secret"), body.get("response"), body.get("remoteip")]).toEqual(["s3cret", "tok", "1.2.3.4"]);
  });

  it("is false for a hostname that is not allowed", async () => {
    expect(await verifyTurnstile(cfg, "tok", null, fetchReturning({ success: true, hostname: "evil.example" }))).toBe(false);
  });

  it("is false when Cloudflare says success is false", async () => {
    expect(await verifyTurnstile(cfg, "tok", null, fetchReturning({ success: false, hostname: HOST }))).toBe(false);
  });

  it("is false without a token or a secret and never calls fetch", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = fetchReturning({ success: true, hostname: HOST }, calls);
    expect(await verifyTurnstile(cfg, undefined, null, f)).toBe(false);
    expect(await verifyTurnstile(cfg, "", null, f)).toBe(false);
    expect(await verifyTurnstile({ ...cfg, TURNSTILE_SECRET: "" }, "tok", null, f)).toBe(false);
    expect(calls.length).toBe(0);
  });

  it("is false when fetch throws or the answer is not JSON", async () => {
    expect(await verifyTurnstile(cfg, "tok", null, (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstile(cfg, "tok", null, (async () => new Response("<html>")) as unknown as typeof fetch)).toBe(false);
  });
});

describe("attempt start", () => {
  const grader = fakeGrader(() => jsonRes({}));
  const q = fakeQueue();
  beforeAll(async () => {
    await env.DB.prepare(
      "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric, reference_solution, test_cases, starter_code, created_at)" +
        " VALUES ('bank:tp', NULL, 'system', 's','f','[]','{\"correctness\":100}','r','[{\"args\":[1],\"expected\":1,\"is_public\":false}]','c','2026-01-01T00:00:00Z')").run();
  });
  const setup = async () => {
    const r = await client(grader.binding, undefined, undefined, { GRADING_QUEUE: q.binding })("POST", "/api/teacher/exams", { as: "t7@x.com", body: { title: "T", questions: [{ problem_id: "bank:tp" }] } });
    return r.json.student_token as string;
  };

  it("is 400 when the verification fails and creates no attempt", async () => {
    const token = await setup();
    const c = client(grader.binding, undefined, undefined, { GRADING_QUEUE: q.binding, turnstile: async () => false });
    const before = (await env.DB.prepare("SELECT count(*) AS n FROM attempts").first<any>()).n;
    const r = await c("POST", `/api/exam/${token}/attempts`, { body: { student_name: "Bot", turnstile_token: "x" } });
    expect(r.status).toBe(400);
    expect(r.json.detail).toBe("Please complete the verification.");
    expect((await env.DB.prepare("SELECT count(*) AS n FROM attempts").first<any>()).n).toBe(before);
  });

  it("passes the token and client IP to the verifier and starts when it says yes", async () => {
    const token = await setup();
    const seen: unknown[] = [];
    const c = client(grader.binding, undefined, undefined, { GRADING_QUEUE: q.binding, turnstile: async (t: string | undefined, ip: string | null) => { seen.push([t, ip]); return true; } });
    const r = await c("POST", `/api/exam/${token}/attempts`, { body: { student_name: "Human", turnstile_token: "good" }, headers: { "CF-Connecting-IP": "198.51.100.4" } });
    expect(r.status).toBe(200);
    expect(seen).toEqual([["good", "198.51.100.4"]]);
  });

  it("is not asked for a malformed name (no Turnstile call is wasted)", async () => {
    const token = await setup();
    const seen: unknown[] = [];
    const c = client(grader.binding, undefined, undefined, { GRADING_QUEUE: q.binding, turnstile: async () => { seen.push(1); return true; } });
    expect((await c("POST", `/api/exam/${token}/attempts`, { body: { student_name: "  ", turnstile_token: "t" } })).status).toBe(400);
    expect(seen.length).toBe(0);
  });
});

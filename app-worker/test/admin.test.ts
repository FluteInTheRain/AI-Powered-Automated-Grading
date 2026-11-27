import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { isAdmin } from "../src/admin";
import { queryHealth } from "../src/analytics_sql";
import { createAppeal, decideAppeal } from "../src/db/appeals";
import { overturnStats } from "../src/db/overturn";
import { runCanary } from "../src/canary";
import { seedGradedAttempt } from "./appeals_fixture";
import { client, fakeGrader, jsonRes } from "./helpers";

const ADMIN = "boss@x.com";
const creds = { CF_ACCOUNT_ID: "acc1", CF_API_TOKEN: "tok1" };
const noGrader = fakeGrader(async () => jsonRes({}));
const call = (extra: Record<string, unknown> = {}) => client(noGrader.binding, undefined, undefined, { ADMIN_EMAILS: ADMIN, ...extra });
beforeEach(async () => { await env.DB.prepare("DELETE FROM canary_runs").run(); });

describe("isAdmin", () => {
  it("matches case-insensitively in a comma-separated list", () => {
    expect(isAdmin({ ADMIN_EMAILS: " A@x.com, Boss@X.com " }, "boss@x.COM")).toBe(true);
  });
  it("rejects strangers, empty and absent lists", () => {
    expect(isAdmin({ ADMIN_EMAILS: "a@x.com" }, "b@x.com")).toBe(false);
    expect(isAdmin({ ADMIN_EMAILS: "" }, "")).toBe(false);
    expect(isAdmin({}, "a@x.com")).toBe(false);
  });
});

describe("queryHealth", () => {
  const body = { data: [{ day: "2026-11-27 00:00:00", outcome: "done", count: 5, p50_ms: 900, p95_ms: 2100 }] };

  it("sends one authorized POST to the account's SQL endpoint and maps the rows", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return jsonRes(body); }) as unknown as typeof fetch;
    const rows = await queryHealth(creds, fetchFn);
    expect(rows).toEqual([{ day: "2026-11-27", outcome: "done", count: 5, p50_ms: 900, p95_ms: 2100 }]);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/analytics_engine/sql");
    expect(seen[0].init.method).toBe("POST");
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok1");
    expect(String(seen[0].init.body)).toContain("grading_events");
    expect(String(seen[0].init.body)).toContain("quantileExactWeighted(0.95)(");
    expect(String(seen[0].init.body)).toContain("now()");
  });

  it.each([
    ["non-200", async () => jsonRes({ errors: [] }, 500)],
    ["a thrown fetch", async () => { throw new Error("offline"); }],
    ["a malformed body", async () => new Response("not json")],
    ["a body without data", async () => jsonRes({ nope: 1 })],
  ])("returns null on %s", async (_n, h) => {
    expect(await queryHealth(creds, h as unknown as typeof fetch)).toBeNull();
  });

  it("returns null without credentials and does not call fetch", async () => {
    let called = false;
    const fetchFn = (async () => { called = true; return jsonRes(body); }) as unknown as typeof fetch;
    expect(await queryHealth({}, fetchFn)).toBeNull();
    expect(called).toBe(false);
  });
});

describe("overturnStats", () => {
  it("counts filed, decided and adjusted appeals and the mean score change", async () => {
    await env.DB.prepare("DELETE FROM appeals").run();
    const [a, b] = [await seedGradedAttempt(), await seedGradedAttempt()];
    const ia = await createAppeal(env.DB, { submissionId: a.submissionId, message: "m", now: new Date() });
    await createAppeal(env.DB, { submissionId: b.submissionId, message: "m", now: new Date() });
    await decideAppeal(env.DB, { id: ia, decision: "adjusted", note: "n", score: 80, teacherEmail: "t@x.com", now: new Date() });
    const s = await overturnStats(env.DB);
    expect(s).toMatchObject({ filed: 2, decided: 1, adjusted: 1 });
    expect(s.mean_delta).toBeCloseTo(20); // 60 -> 80
  });

  it("has no mean change when nothing was adjusted", async () => {
    await env.DB.prepare("DELETE FROM appeals").run();
    expect(await overturnStats(env.DB)).toEqual({ filed: 0, decided: 0, adjusted: 0, mean_delta: null });
  });
});

describe("GET /api/teacher/admin/metrics", () => {
  it("is forbidden for a teacher who is not an admin", async () => {
    const res = await call()("GET", "/api/teacher/admin/metrics", { as: "teacher@x.com" });
    expect(res.status).toBe(403);
  });

  it("is forbidden for everyone when ADMIN_EMAILS is unset", async () => {
    const res = await call({ ADMIN_EMAILS: undefined })("GET", "/api/teacher/admin/metrics", { as: ADMIN });
    expect(res.status).toBe(403);
  });

  it("returns canary and overturn with health null when the SQL API is not configured", async () => {
    await runCanary({ DB: env.DB, GRADER: fakeGrader(async () => jsonRes({
      result: { final_score_0_to_100: 1, sub_scores_0_to_1: {}, execution_result: { pass_count: 0, total: 0, status: "ran" }, check_details: null, feedback: null },
      call_log: [{ kind: "k", model: "m", system_prompt: "s", user_prompt: "u", raw_response: "r" }],
    })).binding, INTERNAL_TOKEN: "t" }, new Date());
    const res = await call()("GET", "/api/teacher/admin/metrics", { as: "BOSS@x.com" });
    expect(res.status).toBe(200);
    expect(res.json.canary).toHaveLength(1);
    expect(res.json.canary[0].verdict).toBe("baseline");
    expect(res.json.health).toBeNull();
    expect(res.json.overturn).toMatchObject({ filed: expect.any(Number) });
    expect(res.json.label).toBe("overturn signal (selection-biased, single rater)");
  });
});

describe("GET /api/teacher/me", () => {
  it("says whether the signed-in teacher is an admin", async () => {
    expect((await call()("GET", "/api/teacher/me", { as: ADMIN })).json).toMatchObject({ email: ADMIN, is_admin: true });
    expect((await call()("GET", "/api/teacher/me", { as: "teacher@x.com" })).json).toMatchObject({ is_admin: false });
  });
});

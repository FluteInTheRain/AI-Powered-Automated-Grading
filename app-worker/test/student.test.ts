import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { client, countingDb, fakeGrader, jsonRes } from "./helpers";

const RUBRIC = JSON.stringify({ correctness: 100 });
const CASES = JSON.stringify([
  { args: [1], expected: "PUBEXP", is_public: true },
  { args: [2], expected: "HIDDENEXP", is_public: false },
]);

let mode: "ok" | "killed" = "ok";
const grader = fakeGrader(async (_n, body) => {
  await Promise.resolve();
  if (mode === "killed") return jsonRes({ detail: "Grading failed: your submission exceeded the time/resource limit." }, 502);
  const score = body.statement.includes("ST_A") ? 80 : 60;
  return jsonRes({
    result: {
      final_score_0_to_100: score, sub_scores_0_to_1: { correctness: 1 },
      execution_result: { pass_count: 1, total: 1, status: "ran", errors: ["input=[2] expected=HIDDENEXP got=3"] },
      check_details: null, feedback: { summary: "nice", issues: [] },
    },
    call_log: [{ kind: "check", schema: "S", model: "m", system_prompt: "sp", user_prompt: "up", raw_response: "rr" }],
  });
});
const call = client(grader.binding);

async function seed(id: string, statement: string) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric," +
      " reference_solution, test_cases, starter_code, created_at) VALUES (?, NULL, 'system', ?, 'f','[\"x\"]',?,'SECRET REF',?,'def f(x): pass','2026-01-01T00:00:00Z')",
  ).bind(id, statement, RUBRIC, CASES).run();
}
beforeAll(async () => { await seed("bank:sa", "ST_A"); await seed("bank:sb", "ST_B"); });

async function newExam(as: string, extra: Record<string, unknown> = {}, weights = [1, 3]) {
  const r = await call("POST", "/api/teacher/exams", {
    as, body: { title: "T", questions: [{ problem_id: "bank:sa", weight: weights[0] }, { problem_id: "bank:sb", weight: weights[1] }], ...extra },
  });
  return { id: r.json.id as string, token: r.json.student_token as string };
}
async function start(token: string, name = "Stu") {
  const r = await call("POST", `/api/exam/${token}/attempts`, { body: { student_name: name } });
  return r;
}
const submit = (token: string, attempt: string, problem: string, code = "def f(x): return 3") =>
  call("POST", `/api/exam/${token}/attempts/${attempt}/questions/${problem}/submit`, { body: { code } });
const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<any>()).n;

describe("student flow", () => {
  it("exam view has no hidden cases or reference", async () => {
    const { token } = await newExam("s1@x.com");
    const r = await call("GET", `/api/exam/${token}`);
    expect(r.status).toBe(200);
    expect(r.json.questions).toHaveLength(2);
    expect(r.json.questions[0].public_cases).toEqual([{ args: [1], expected: "PUBEXP" }]);
    expect(r.text).not.toContain("HIDDENEXP");
    expect(r.text).not.toContain("SECRET REF");
  });

  it("attempt then submit stores submission, revision 0 and logs", async () => {
    const { token } = await newExam("s2@x.com");
    const a = await start(token);
    expect(a.json.receipt_code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    const [s0, r0, l0] = [await count("submissions"), await count("score_revisions"), await count("grading_logs")];
    const r = await submit(token, a.json.attempt_id, "bank:sa");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ problem_id: "bank:sa", score: 80, tests: { passed: 1, total: 1 } });
    expect([await count("submissions"), await count("score_revisions"), await count("grading_logs")]).toEqual([s0 + 1, r0 + 1, l0 + 1]);
    const rev = await env.DB.prepare("SELECT revision, source, score, author FROM score_revisions ORDER BY rowid DESC LIMIT 1").first<any>();
    expect(rev).toEqual({ revision: 0, source: "ai", score: 80, author: "pipeline" });
    expect(grader.calls.at(-1)!.body.hidden_cases).toEqual([{ args: [2], expected: "HIDDENEXP", is_public: false }]);
  });

  it("submit response never contains expected values", async () => {
    const { token } = await newExam("s3@x.com");
    const a = await start(token);
    const r = await submit(token, a.json.attempt_id, "bank:sa");
    expect(r.text).not.toContain("HIDDENEXP");
    expect(r.text.toLowerCase()).not.toContain("expected");
  });

  it("second submit for the same question is 409", async () => {
    const { token } = await newExam("s4@x.com");
    const a = await start(token);
    expect((await submit(token, a.json.attempt_id, "bank:sa")).status).toBe(200);
    expect((await submit(token, a.json.attempt_id, "bank:sa")).status).toBe(409);
  });

  it("concurrent double submit: one 200, one 409", async () => {
    const { token } = await newExam("s5@x.com");
    const a = await start(token);
    const [x, y] = await Promise.all([submit(token, a.json.attempt_id, "bank:sa"), submit(token, a.json.attempt_id, "bank:sa")]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM submissions WHERE attempt_id = ?").bind(a.json.attempt_id).first<any>();
    expect(n.n).toBe(1);
  });

  it("closed exam rejects attempt and submit with 403", async () => {
    const open = await newExam("s6@x.com");
    const a = await start(open.token);
    await call("PATCH", `/api/teacher/exams/${open.id}`, { as: "s6@x.com", body: { deadline: "2000-01-01T00:00:00Z" } });
    expect((await submit(open.token, a.json.attempt_id, "bank:sa")).status).toBe(403);
    expect((await start(open.token)).status).toBe(403);
  });

  it("grader failure persists nothing and allows a retry", async () => {
    const { token } = await newExam("s7@x.com");
    const a = await start(token);
    const before = await count("submissions");
    mode = "killed";
    const bad = await submit(token, a.json.attempt_id, "bank:sa");
    mode = "ok";
    expect(bad.status).toBe(502);
    expect(bad.json.detail).toContain("time/resource");
    expect(await count("submissions")).toBe(before);
    expect((await submit(token, a.json.attempt_id, "bank:sa")).status).toBe(200);
  });

  it("attempt from another exam is 404", async () => {
    const e1 = await newExam("s8@x.com");
    const e2 = await newExam("s8@x.com");
    const a = await start(e1.token);
    expect((await submit(e2.token, a.json.attempt_id, "bank:sa")).status).toBe(404);
    expect((await submit(e1.token, a.json.attempt_id, "bank:not-in-exam")).status).toBe(404);
  });

  it("unknown student token and receipt are 404", async () => {
    expect((await call("GET", "/api/exam/deadbeef")).status).toBe(404);
    expect((await start("deadbeef")).status).toBe(404);
    const { token } = await newExam("s9@x.com");
    expect((await call("GET", `/api/exam/${token}/attempts/by-receipt/NOSUCHCODE`)).status).toBe(404);
  });

  it("name over 100 and code over 20000 chars are 400", async () => {
    const { token } = await newExam("s10@x.com");
    expect((await start(token, "n".repeat(101))).status).toBe(400);
    expect((await start(token, "   ")).status).toBe(400);
    const a = await start(token);
    expect((await submit(token, a.json.attempt_id, "bank:sa", "x".repeat(20001))).status).toBe(400);
    expect((await submit(token, a.json.attempt_id, "bank:sa", "")).status).toBe(400);
  });

  it("total is null until all questions are submitted, then weighted", async () => {
    const { token } = await newExam("s11@x.com");
    const a = await start(token, "Pat");
    const by = () => call("GET", `/api/exam/${token}/attempts/by-receipt/${a.json.receipt_code}`);
    await submit(token, a.json.attempt_id, "bank:sa");
    const half = await by();
    expect(half.json.total).toBeNull();
    expect(half.json.questions.map((q: any) => q.score)).toEqual([80, null]);
    await submit(token, a.json.attempt_id, "bank:sb");
    const full = await by();
    expect(full.json.total).toBe(65);
    expect(full.json.student_name).toBe("Pat");
    expect(full.json.questions[0].feedback).toEqual({ summary: "nice", issues: [] });
  });

  it("latest revision wins", async () => {
    const { token } = await newExam("s12@x.com");
    const a = await start(token);
    await submit(token, a.json.attempt_id, "bank:sa");
    const sub = await env.DB.prepare("SELECT id FROM submissions WHERE attempt_id = ?").bind(a.json.attempt_id).first<any>();
    await env.DB.prepare(
      "INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, reason, created_at)" +
        " VALUES ('rev-s12', ?, 1, 'teacher', 95, '{}', '{}', 't', 'fair', '2026-11-25T00:00:00Z')",
    ).bind(sub.id).run();
    const r = await call("GET", `/api/exam/${token}/attempts/by-receipt/${a.json.receipt_code}`);
    expect(r.json.questions[0].score).toBe(95);
  });

  it("teacher results only for the own exam", async () => {
    const { id, token } = await newExam("s13@x.com");
    const a = await start(token, "Rae");
    await submit(token, a.json.attempt_id, "bank:sa");
    const ok = await call("GET", `/api/teacher/exams/${id}/results`, { as: "s13@x.com" });
    expect(ok.status).toBe(200);
    expect(ok.json[0]).toMatchObject({ student_name: "Rae", total: null });
    expect(ok.json[0].questions[0]).toMatchObject({ problem_id: "bank:sa", score: 80 });
    expect((await call("GET", `/api/teacher/exams/${id}/results`, { as: "other13@x.com" })).status).toBe(404);
  });

  it("submit after the time limit is 403, within it is 200", async () => {
    const { token } = await newExam("s14@x.com");
    const a = await start(token);
    const path = `/api/exam/${token}/attempts/${a.json.attempt_id}/questions/bank:sa/submit`;
    const body = { code: "def f(x): return 3" };
    const late = client(grader.binding, () => new Date(Date.now() + 700_000));
    const r = await late("POST", path, { body });
    expect(r.status).toBe(403);
    expect(r.json.detail).toBe("Time limit exceeded");
    const inTime = client(grader.binding, () => new Date(Date.now() + 100_000));
    expect((await inTime("POST", path, { body })).status).toBe(200);
  });

  it("teacher results use a constant number of queries", async () => {
    const { id, token } = await newExam("s15@x.com");
    for (let i = 0; i < 60; i++) await start(token, `N${i}`);
    const c = countingDb(env.DB);
    const r = await client(grader.binding, undefined, c.db)("GET", `/api/teacher/exams/${id}/results`, { as: "s15@x.com" });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(60);
    expect(c.count()).toBeLessThanOrEqual(6);
  });
});

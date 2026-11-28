import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { client, countingDb, drain, fakeGrader, fakeQueue, jsonRes } from "./helpers";

const RUBRIC = JSON.stringify({ correctness: 100 });
const CASES = JSON.stringify([
  { args: [1], expected: "PUBEXP", is_public: true },
  { args: [2], expected: "HIDDENEXP", is_public: false },
]);
const SECRETS = ["PUBEXP", "HIDDENEXP", "SECRET REF"];

let mode: "ok" | "killed" | "5xx" = "ok";
const grader = fakeGrader(async (name, body) => {
  await Promise.resolve();
  if (mode === "killed") return jsonRes({ detail: "Grading failed: your submission exceeded the time/resource limit." }, 502);
  if (mode === "5xx") return jsonRes({ detail: "stack trace" }, 500);
  if (name === "run") return jsonRes({ status: "ran", message: null, cases: body.cases.map(() => ({ passed: true, error: null })) });
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
const q = fakeQueue();
const call = client(grader.binding, undefined, undefined, { GRADING_QUEUE: q.binding });
const at = (offsetMs: number) => client(grader.binding, () => new Date(Date.now() + offsetMs), undefined, { GRADING_QUEUE: q.binding });

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
const start = (token: string, name = "Stu", c = call) => c("POST", `/api/exam/${token}/attempts`, { body: { student_name: name } });
const qpath = (token: string, attempt: string, problem: string, tail: string) => `/api/exam/${token}/attempts/${attempt}/questions/${problem}/${tail}`;
const ANSWERS = { "bank:sa": "def f(x): return 3", "bank:sb": "def f(x): return 4" };
const submitAll = (token: string, attempt: string, answers: Record<string, string> = ANSWERS, c = call) =>
  c("POST", `/api/exam/${token}/attempts/${attempt}/submit`, { body: { answers } });
const status = (token: string, attempt: string, problem: string) => call("GET", qpath(token, attempt, problem, "status"));
const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<any>()).n;
const finish = () => drain(q, grader.binding);

describe("exam summary and attempt start", () => {
  it("the summary has no questions and no test values", async () => {
    const { token } = await newExam("s1@x.com");
    const r = await call("GET", `/api/exam/${token}`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ title: "T", deadline: null, time_limit_seconds: 600, is_closed: false, question_count: 2, turnstile_site_key: "", appeals_enabled: true });
    for (const s of SECRETS) expect(r.text).not.toContain(s);
  });

  it("starting returns the questions, the remaining seconds and a receipt, never test values", async () => {
    const { token } = await newExam("s2@x.com");
    const r = await start(token);
    expect(r.status).toBe(200);
    expect(r.json.receipt_code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(r.json.remaining_seconds).toBe(600);
    expect(r.json.questions).toHaveLength(2);
    expect(r.json.questions[0]).toMatchObject({
      problem_id: "bank:sa", position: 0, weight: 1, statement: "ST_A", starter_code: "def f(x): pass",
      rubric: { correctness: 100 }, public_case_count: 1, hidden_case_count: 1,
    });
    for (const s of SECRETS) expect(r.text).not.toContain(s);
  });

  it("the same name again in one exam is a 409 that points to the receipt code", async () => {
    const { token } = await newExam("s3@x.com");
    expect((await start(token, "An Nguyen")).status).toBe(200);
    const again = await start(token, "  an nguyen ");
    expect(again.status).toBe(409);
    expect(again.json.detail).toContain("receipt");
  });

  it("unknown links are 404, bad names are 400, a closed exam is 403", async () => {
    expect((await call("GET", "/api/exam/deadbeef")).status).toBe(404);
    expect((await start("deadbeef")).status).toBe(404);
    const e = await newExam("s4@x.com");
    expect((await start(e.token, "n".repeat(101))).status).toBe(400);
    expect((await start(e.token, "   ")).status).toBe(400);
    await call("PATCH", `/api/teacher/exams/${e.id}`, { as: "s4@x.com", body: { deadline: "2000-01-01T00:00:00Z" } });
    expect((await start(e.token, "Late")).status).toBe(403);
  });
});

describe("resume", () => {
  it("returns the questions, the remaining time, the submitted flag and each question's status", async () => {
    const { token } = await newExam("s5@x.com");
    const a = (await start(token, "Rey")).json;
    const before = await call("GET", `/api/exam/${token}/attempts/${a.attempt_id}`);
    expect(before.json).toMatchObject({ student_name: "Rey", receipt_code: a.receipt_code, submitted: false });
    expect(before.json.remaining_seconds).toBeLessThanOrEqual(600);
    expect(before.json.remaining_seconds).toBeGreaterThan(590);
    expect(before.json.questions.map((x: any) => x.status)).toEqual(["none", "none"]);
    await submitAll(token, a.attempt_id);
    const r = await call("GET", `/api/exam/${token}/attempts/${a.attempt_id}`);
    expect(r.json.submitted).toBe(true);
    expect(r.json.questions.map((x: any) => [x.problem_id, x.status])).toEqual([["bank:sa", "queued"], ["bank:sb", "queued"]]);
    await finish();
    const after = await call("GET", `/api/exam/${token}/attempts/${a.attempt_id}`);
    expect(after.json.questions.map((x: any) => x.status)).toEqual(["done", "done"]);
    for (const s of SECRETS) expect(r.text).not.toContain(s);
  });

  it("an unknown attempt, or one from another exam, is 404", async () => {
    const e1 = await newExam("s6@x.com");
    const e2 = await newExam("s6@x.com");
    const a = (await start(e1.token)).json;
    expect((await call("GET", `/api/exam/${e1.token}/attempts/nope`)).status).toBe(404);
    expect((await call("GET", `/api/exam/${e2.token}/attempts/${a.attempt_id}`)).status).toBe(404);
  });
});

describe("submit the whole exam", () => {
  it("answers 202, stores every question with a queued job and enqueues one message each", async () => {
    const { token } = await newExam("s7@x.com");
    const a = (await start(token)).json;
    const [subs, jobs, sent] = [await count("submissions"), await count("grading_jobs"), q.sent.length];
    const r = await submitAll(token, a.attempt_id);
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ status: "queued", problem_ids: ["bank:sa", "bank:sb"] });
    expect([await count("submissions"), await count("grading_jobs"), q.sent.length]).toEqual([subs + 2, jobs + 2, sent + 2]);
    expect((await status(token, a.attempt_id, "bank:sb")).json).toEqual({ status: "queued" });
    await finish();
  });

  it("unanswered and empty answers use the starter code", async () => {
    const { token } = await newExam("s7b@x.com");
    const a = (await start(token)).json;
    expect((await submitAll(token, a.attempt_id, { "bank:sa": "" })).status).toBe(202);
    const rows = await env.DB.prepare("SELECT problem_id, code FROM submissions WHERE attempt_id = ? ORDER BY problem_id").bind(a.attempt_id).all<any>();
    expect(rows.results).toEqual([{ problem_id: "bank:sa", code: "def f(x): pass" }, { problem_id: "bank:sb", code: "def f(x): pass" }]);
    const callsBefore = grader.calls.length;
    await finish();
    // Blank answers are scored zero by the Worker itself: no sandbox run and no LLM call at all.
    expect(grader.calls.length).toBe(callsBefore);
    const r = await status(token, a.attempt_id, "bank:sb");
    expect(r.json).toMatchObject({ status: "done", score: 0 });
  });

  it("a second submit is 409 and adds nothing; a concurrent pair has one 202 and one 409", async () => {
    const { token } = await newExam("s8@x.com");
    const a = (await start(token)).json;
    expect((await submitAll(token, a.attempt_id)).status).toBe(202);
    expect((await submitAll(token, a.attempt_id)).status).toBe(409);
    const b = (await start(token, "Other")).json;
    const [x, y] = await Promise.all([submitAll(token, b.attempt_id), submitAll(token, b.attempt_id)]);
    expect([x.status, y.status].sort()).toEqual([202, 409]);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM submissions WHERE attempt_id = ?").bind(b.attempt_id).first<any>();
    expect(n.n).toBe(2);
    await finish();
  });

  it("a repeated submit is a 409 even after the time is up (an answered 503 must not turn into a 403)", async () => {
    const { token } = await newExam("s8c@x.com");
    const a = (await start(token)).json;
    expect((await submitAll(token, a.attempt_id)).status).toBe(202);
    expect((await submitAll(token, a.attempt_id, ANSWERS, at(700_000))).status).toBe(409);
    await finish();
  });

  it("an unknown problem id, oversized code or a non-object body is a 400 and nothing is stored", async () => {
    const { token } = await newExam("s8b@x.com");
    const a = (await start(token)).json;
    const subs = await count("submissions");
    expect((await submitAll(token, a.attempt_id, { "bank:zzz": "x" })).status).toBe(400);
    expect((await submitAll(token, a.attempt_id, { "bank:sa": "x".repeat(20001) })).status).toBe(400);
    expect((await call("POST", `/api/exam/${token}/attempts/${a.attempt_id}/submit`, { body: { answers: "nope" } })).status).toBe(400);
    expect((await call("POST", `/api/exam/${token}/attempts/${a.attempt_id}/submit`, { body: {} })).status).toBe(400);
    expect(await count("submissions")).toBe(subs);
  });

  it("after the time limit it is 403, within it 202; an unknown attempt is 404", async () => {
    const { token } = await newExam("s10@x.com");
    const a = (await start(token)).json;
    expect((await submitAll(token, a.attempt_id, ANSWERS, at(700_000))).status).toBe(403);
    expect((await submitAll(token, "nope")).status).toBe(404);
    expect((await submitAll(token, a.attempt_id, ANSWERS, at(100_000))).status).toBe(202);
    await finish();
  });

  it("an attempt without clock state (created before Phase 2) cannot submit", async () => {
    const { token } = await newExam("s11@x.com");
    const ex = await env.DB.prepare("SELECT id FROM exams WHERE student_token = ?").bind(token).first<any>();
    const { createAttempt } = await import("../src/db/attempts");
    const old = await createAttempt(env.DB, ex.id, "Legacy", new Date());
    expect((await submitAll(token, old.attempt_id)).status).toBe(403);
  });

  it("a closed exam rejects submit, with ten seconds of grace after the deadline", async () => {
    const e = await newExam("s12@x.com");
    const a = (await start(e.token)).json;
    await call("PATCH", `/api/teacher/exams/${e.id}`, { as: "s12@x.com", body: { deadline: new Date(Date.now() - 30_000).toISOString() } });
    expect((await submitAll(e.token, a.attempt_id)).status).toBe(403);
    const f = await newExam("s12b@x.com");
    const b = (await start(f.token)).json;
    await call("PATCH", `/api/teacher/exams/${f.id}`, { as: "s12b@x.com", body: { deadline: new Date(Date.now() - 5_000).toISOString() } });
    expect((await submitAll(f.token, b.attempt_id)).status).toBe(202);
    expect((await start(f.token, "Too Late")).status).toBe(403);
    await finish();
  });

  it("when the queue send fails it is 503, every job stays queued, and each question can be retried once stuck", async () => {
    const { token } = await newExam("s13@x.com");
    const a = (await start(token)).json;
    q.failNext();
    expect((await submitAll(token, a.attempt_id)).status).toBe(503);
    for (const p of ["bank:sa", "bank:sb"]) {
      expect((await status(token, a.attempt_id, p)).json).toEqual({ status: "queued" });
      const retryPath = qpath(token, a.attempt_id, p, "retry");
      expect((await call("POST", retryPath)).status).toBe(409); // too soon: the job may still be in flight
      expect((await at(130_000)("POST", retryPath)).status).toBe(202);
    }
    await finish();
    expect((await status(token, a.attempt_id, "bank:sb")).json.status).toBe("done");
  });

  it("a storage error after the claim releases it, so the student can submit again", async () => {
    const { token } = await newExam("s14d@x.com");
    const a = (await start(token)).json;
    let broke = false;
    const flaky = new Proxy(env.DB, {
      get(t, k) {
        if (k === "batch") return async (st: D1PreparedStatement[]) => { if (!broke) { broke = true; throw new Error("D1_ERROR transient"); } return t.batch(st); };
        const v = (t as any)[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as D1Database;
    const c = client(grader.binding, undefined, flaky, { GRADING_QUEUE: q.binding });
    expect((await submitAll(token, a.attempt_id, ANSWERS, c)).status).toBe(500);
    expect((await submitAll(token, a.attempt_id, ANSWERS, c)).status).toBe(202);
    await finish();
  });

  it("the old per-question submit route is gone", async () => {
    const { token } = await newExam("s14g@x.com");
    const a = (await start(token)).json;
    expect((await call("POST", qpath(token, a.attempt_id, "bank:sa", "submit"), { body: { code: "x" } })).status).toBe(404);
  });
});

describe("status and retry", () => {
  it("after the consumer runs, status shows the score, tests and feedback but no expected values", async () => {
    const { token } = await newExam("s9@x.com");
    const a = (await start(token)).json;
    await submitAll(token, a.attempt_id);
    await finish();
    const r = await status(token, a.attempt_id, "bank:sa");
    expect(r.json).toMatchObject({ status: "done", score: 80, sub_scores: { correctness: 1 }, tests: { passed: 1, total: 1 }, feedback: { summary: "nice" } });
    for (const s of SECRETS) expect(r.text).not.toContain(s);
    expect(r.text.toLowerCase()).not.toContain("expected");
  });

  it("a transient failure is retryable and retry grades it again", async () => {
    const { token } = await newExam("s14@x.com");
    const a = (await start(token)).json;
    mode = "5xx";
    await submitAll(token, a.attempt_id);
    await drain(q, grader.binding, 3); // third delivery: out of attempts
    mode = "ok";
    const failed = await status(token, a.attempt_id, "bank:sa");
    expect(failed.json).toMatchObject({ status: "failed", error: "Grading service error, please try again.", retryable: true });
    expect((await call("POST", qpath(token, a.attempt_id, "bank:sa", "retry"))).status).toBe(202);
    await finish();
    expect((await status(token, a.attempt_id, "bank:sa")).json.status).toBe("done");
  });

  it("a sandbox kill is permanent: not retryable, and retry is refused", async () => {
    const { token } = await newExam("s14b@x.com");
    const a = (await start(token)).json;
    mode = "killed";
    await submitAll(token, a.attempt_id);
    await finish();
    mode = "ok";
    const failed = await status(token, a.attempt_id, "bank:sa");
    expect(failed.json).toMatchObject({ status: "failed", retryable: false });
    expect(failed.json.error).toContain("time/resource");
    const calls = grader.calls.length;
    expect((await call("POST", qpath(token, a.attempt_id, "bank:sa", "retry"))).status).toBe(409);
    expect(grader.calls.length).toBe(calls);
  });

  it("a job stuck in queued or grading is reported stuck and can be retried", async () => {
    const { token } = await newExam("s14c@x.com");
    const a = (await start(token)).json;
    await submitAll(token, a.attempt_id);
    expect((await status(token, a.attempt_id, "bank:sa")).json).toEqual({ status: "queued" });
    await env.DB.prepare("UPDATE grading_jobs SET status = 'grading', updated_at = '2000-01-01T00:00:00Z' WHERE submission_id = (SELECT id FROM submissions WHERE attempt_id = ? AND problem_id = 'bank:sa')").bind(a.attempt_id).run();
    expect((await status(token, a.attempt_id, "bank:sa")).json).toEqual({ status: "grading", stuck: true });
    expect((await call("POST", qpath(token, a.attempt_id, "bank:sa", "retry"))).status).toBe(202);
    await finish();
    expect((await status(token, a.attempt_id, "bank:sa")).json.status).toBe("done");
  });

  it("retry on a finished or never-submitted question is 409", async () => {
    const { token } = await newExam("s15@x.com");
    const a = (await start(token)).json;
    expect((await call("POST", qpath(token, a.attempt_id, "bank:sa", "retry"))).status).toBe(409);
    await submitAll(token, a.attempt_id);
    await finish();
    expect((await call("POST", qpath(token, a.attempt_id, "bank:sa", "retry"))).status).toBe(409);
  });
});

describe("run public tests", () => {
  const run = (token: string, attempt: string, problem = "bank:sa", code = "def f(x): return 3", c = call) =>
    c("POST", qpath(token, attempt, problem, "run"), { body: { code } });

  it("sends only the public cases and returns the grader body", async () => {
    const { token } = await newExam("r1@x.com");
    const a = (await start(token)).json;
    const r = await run(token, a.attempt_id);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "ran", message: null, cases: [{ passed: true, error: null }] });
    const sent = grader.calls.at(-1)!;
    expect(sent.name).toBe("run");
    expect(sent.body.cases).toEqual([{ args: [1], expected: "PUBEXP", is_public: true }]);
  });

  it("after the time limit it is 403", async () => {
    const { token } = await newExam("r2@x.com");
    const a = (await start(token)).json;
    const r = await run(token, a.attempt_id, "bank:sa", "x", at(700_000));
    expect(r.status).toBe(403);
    expect(r.json.detail).toBe("Time limit exceeded");
  });

  it("unknown attempt or question is 404 and empty code is 400", async () => {
    const { token } = await newExam("r3@x.com");
    const a = (await start(token)).json;
    expect((await run(token, "nope")).status).toBe(404);
    expect((await run(token, a.attempt_id, "bank:zzz")).status).toBe(404);
    expect((await run(token, a.attempt_id, "bank:sa", "")).status).toBe(400);
  });

  it("a grader failure is a 502 with the grader's fixed text", async () => {
    const { token } = await newExam("r4@x.com");
    const a = (await start(token)).json;
    mode = "killed";
    const r = await run(token, a.attempt_id);
    mode = "ok";
    expect(r.status).toBe(502);
    expect(r.json.detail).toContain("time/resource");
  });
});

describe("receipt lookup and teacher results", () => {
  const byReceipt = (token: string, code: string) => call("GET", `/api/exam/${token}/attempts/by-receipt/${code}`);

  it("unknown token and receipt are 404", async () => {
    expect((await byReceipt("deadbeef", "X")).status).toBe(404);
    const { token } = await newExam("c1@x.com");
    expect((await byReceipt(token, "NOSUCHCODE")).status).toBe(404);
  });

  it("the total is null until every question is graded, then weighted (80 and 60 with weights 1 and 3 give 65)", async () => {
    const { token } = await newExam("c2@x.com");
    const a = (await start(token, "Pat")).json;
    await submitAll(token, a.attempt_id);
    const pending = await byReceipt(token, a.receipt_code);
    expect(pending.json.total).toBeNull(); // queued, not graded yet
    expect(pending.json.questions.map((x: any) => [x.score, x.status])).toEqual([[null, "queued"], [null, "queued"]]);
    await finish();
    const full = await byReceipt(token, a.receipt_code);
    expect(full.json.total).toBe(65);
    expect(full.json.student_name).toBe("Pat");
    expect(full.json.questions[0].feedback).toEqual({ summary: "nice", issues: [] });
  });

  it("the latest revision wins", async () => {
    const { token } = await newExam("c3@x.com");
    const a = (await start(token)).json;
    await submitAll(token, a.attempt_id);
    await finish();
    const sub = await env.DB.prepare("SELECT id FROM submissions WHERE attempt_id = ? AND problem_id = 'bank:sa'").bind(a.attempt_id).first<any>();
    await env.DB.prepare(
      "INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, reason, created_at)" +
        " VALUES ('rev-c3', ?, 1, 'teacher', 95, '{}', '{}', 't', 'fair', '2026-11-26T00:00:00Z')",
    ).bind(sub.id).run();
    expect((await byReceipt(token, a.receipt_code)).json.questions[0].score).toBe(95);
  });

  it("teacher results only for the own exam", async () => {
    const { id, token } = await newExam("c4@x.com");
    const a = (await start(token, "Rae")).json;
    await submitAll(token, a.attempt_id);
    await finish();
    const ok = await call("GET", `/api/teacher/exams/${id}/results`, { as: "c4@x.com" });
    expect(ok.status).toBe(200);
    expect(ok.json[0]).toMatchObject({ student_name: "Rae", total: 65 });
    expect(ok.json[0].questions[0]).toMatchObject({ problem_id: "bank:sa", score: 80 });
    expect((await call("GET", `/api/teacher/exams/${id}/results`, { as: "other-c4@x.com" })).status).toBe(404);
  });

  it("results carry a grading status per question: none, queued, done and failed", async () => {
    const { id, token } = await newExam("c5@x.com");
    const a = (await start(token, "Stat")).json;
    const results = async () => (await call("GET", `/api/teacher/exams/${id}/results`, { as: "c5@x.com" })).json[0].questions.map((x: any) => x.status);
    expect(await results()).toEqual(["none", "none"]);
    await submitAll(token, a.attempt_id);
    expect(await results()).toEqual(["queued", "queued"]);
    await finish();
    expect(await results()).toEqual(["done", "done"]);
    const f = await newExam("c5b@x.com");
    const b = (await start(f.token, "Dead")).json;
    mode = "killed";
    await submitAll(f.token, b.attempt_id);
    await finish();
    mode = "ok";
    const row = (await call("GET", `/api/teacher/exams/${f.id}/results`, { as: "c5b@x.com" })).json[0];
    expect(row.questions.map((x: any) => [x.status, x.score])).toEqual([["failed", 0], ["failed", 0]]);
    expect(row.total).toBe(0); // a permanent failure scores zero, so the exam still gets a total
  });

  it("teacher results use a constant number of queries however many attempts exist", async () => {
    const { id, token } = await newExam("c6@x.com");
    for (let i = 0; i < 60; i++) await start(token, `N${i}`);
    const c = countingDb(env.DB);
    const r = await client(grader.binding, undefined, c.db, { GRADING_QUEUE: q.binding })("GET", `/api/teacher/exams/${id}/results`, { as: "c6@x.com" });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(60);
    expect(c.count()).toBeLessThanOrEqual(6);
  });
});

describe("exam rubric reaches the student view and the grader", () => {
  const W = { correctness: 70, efficiency: 10, code_style: 10, edge_case_handling: 10 };

  it("the student payload shows the exam rubric", async () => {
    const e = await newExam("rubst1@x.com", { rubric: W });
    const s = await start(e.token, "Rub St");
    expect(s.json.questions.map((x: any) => x.rubric)).toEqual([W, W]);
    expect((await call("GET", `/api/exam/${e.token}`)).status).toBe(200);
  });

  it("an exam without a rubric still shows each problem's own rubric", async () => {
    const e = await newExam("rubst2@x.com");
    const s = await start(e.token, "Rub St2");
    expect(s.json.questions.map((x: any) => x.rubric)).toEqual([{ correctness: 100 }, { correctness: 100 }]);
  });

  it("the grading job sends the exam rubric to the grader", async () => {
    const e = await newExam("rubst3@x.com", { rubric: W });
    const s = await start(e.token, "Rub St3");
    const before = grader.calls.length;
    await submitAll(e.token, s.json.attempt_id);
    await finish();
    const sent = grader.calls.slice(before).filter((c) => c.name === "grade").map((c) => c.body.rubric);
    expect(sent).toEqual([W, W]);
  });
});

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { seedGradedAttempt } from "./appeals_fixture";

type Seed = Awaited<ReturnType<typeof seedGradedAttempt>>;
const OTHER = "someone-else@x.com";

/** A seed with one appeal filed by the student; returns the appeal id too. */
async function withAppeal(opts: { graded?: boolean } = {}) {
  const s = await seedGradedAttempt(opts);
  await s.call("POST", `/api/exam/${s.token}/attempts/by-receipt/${s.receipt}/appeals`, {
    body: { problem_id: s.problemId, message: "Please recheck", turnstile_token: "t" },
  });
  const id = (await env.DB.prepare("SELECT id FROM appeals WHERE submission_id = ?").bind(s.submissionId).first<any>()).id as string;
  return { ...s, appealId: id };
}
const decide = (s: Seed & { appealId: string }, body: unknown, as = s.teacher) =>
  s.call("POST", `/api/teacher/appeals/${s.appealId}/decision`, { as, body });
const revisionCount = async (submissionId: string) =>
  (await env.DB.prepare("SELECT count(*) AS n FROM score_revisions WHERE submission_id = ?").bind(submissionId).first<any>()).n;

describe("list and detail", () => {
  it("the owning teacher lists the exam's appeals", async () => {
    const s = await withAppeal();
    const r = await s.call("GET", `/api/teacher/exams/${s.examId}/appeals`, { as: s.teacher });
    expect(r.status).toBe(200);
    expect(r.json).toEqual([expect.objectContaining({ id: s.appealId, student_name: "Stu", problem_id: s.problemId, status: "open" })]);
  });

  it("the detail has the message, the code, the revisions and the AI call log", async () => {
    const s = await withAppeal();
    const r = await s.call("GET", `/api/teacher/appeals/${s.appealId}`, { as: s.teacher });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: s.appealId, message: "Please recheck", code: "def f(x): return 3", status: "open", student_name: "Stu" });
    expect(r.json.revisions).toEqual([expect.objectContaining({ revision: 0, source: "ai", score: 60 })]);
    expect(r.json.audit.call_log).toEqual([expect.objectContaining({ system_prompt: "sp", user_prompt: "up", raw_response: "rr" })]);
    expect(r.json).not.toHaveProperty("teacher_id");
    expect(r.json).not.toHaveProperty("audit_key");
  });

  it("the detail carries the AI's structured result (tests passed, per-check findings, feedback), not inside the revision list", async () => {
    const s = await withAppeal();
    const r = await s.call("GET", `/api/teacher/appeals/${s.appealId}`, { as: s.teacher });
    expect(r.json.ai_result).toMatchObject({
      final_score_0_to_100: 60, sub_scores_0_to_1: { correctness: 0.6 },
      execution_result: { pass_count: 1, total: 2 }, feedback: { summary: "ok" },
    });
    expect(r.json.revisions[0]).not.toHaveProperty("detail");
  });

  it("a missing R2 audit object still gives a 200 with audit null", async () => {
    const s = await withAppeal();
    await env.AUDIT.delete(`audit/${s.submissionId}.json`);
    const r = await s.call("GET", `/api/teacher/appeals/${s.appealId}`, { as: s.teacher });
    expect(r.status).toBe(200);
    expect(r.json.audit).toBeNull();
  });

  it("another teacher gets 404 on list, detail, review and decision", async () => {
    const s = await withAppeal();
    expect((await s.call("GET", `/api/teacher/exams/${s.examId}/appeals`, { as: OTHER })).status).toBe(404);
    expect((await s.call("GET", `/api/teacher/appeals/${s.appealId}`, { as: OTHER })).status).toBe(404);
    expect((await s.call("POST", `/api/teacher/appeals/${s.appealId}/review`, { as: OTHER })).status).toBe(404);
    expect((await decide(s, { decision: "rejected", note: "n" }, OTHER)).status).toBe(404);
    expect((await s.call("GET", "/api/teacher/appeals/nosuchappeal", { as: s.teacher })).status).toBe(404);
  });
});

describe("review", () => {
  it("moves open to under_review once, then 409", async () => {
    const s = await withAppeal();
    const first = await s.call("POST", `/api/teacher/appeals/${s.appealId}/review`, { as: s.teacher });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ status: "under_review" });
    expect((await s.call("POST", `/api/teacher/appeals/${s.appealId}/review`, { as: s.teacher })).status).toBe(409);
  });
});

describe("decision", () => {
  it("adjusted appends a revision the student then sees", async () => {
    const s = await withAppeal();
    const r = await decide(s, { decision: "adjusted", note: "Edge case was fine", score: 85 });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "adjusted" });
    const list = await s.call("GET", `/api/exam/${s.token}/attempts/by-receipt/${s.receipt}/appeals`);
    expect(list.json).toEqual([expect.objectContaining({ status: "adjusted", decision_note: "Edge case was fine", score: 85 })]);
    const detail = await s.call("GET", `/api/teacher/appeals/${s.appealId}`, { as: s.teacher });
    expect(detail.json.revisions.map((x: any) => [x.revision, x.source, x.score, x.author])).toEqual([[0, "ai", 60, "pipeline"], [1, "teacher", 85, s.teacher]]);
  });

  it("a second decision is a 409 and adds nothing", async () => {
    const s = await withAppeal();
    expect((await decide(s, { decision: "adjusted", note: "n", score: 70 })).status).toBe(200);
    expect((await decide(s, { decision: "adjusted", note: "n", score: 99 })).status).toBe(409);
    expect(await revisionCount(s.submissionId)).toBe(2);
  });

  it("two concurrent decisions: one 200, one 409, one teacher revision", async () => {
    const s = await withAppeal();
    const rs = await Promise.all([
      decide(s, { decision: "adjusted", note: "a", score: 70 }),
      decide(s, { decision: "adjusted", note: "b", score: 80 }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await revisionCount(s.submissionId)).toBe(2);
  });

  it("upheld and rejected leave the score and ignore a score field", async () => {
    const a = await withAppeal();
    expect((await decide(a, { decision: "upheld", note: "AI was right", score: 10 })).status).toBe(200);
    const b = await withAppeal();
    expect((await decide(b, { decision: "rejected", note: "no merit" })).status).toBe(200);
    expect(await revisionCount(a.submissionId)).toBe(1);
    expect(await revisionCount(b.submissionId)).toBe(1);
  });

  it.each([
    ["an unknown decision", { decision: "maybe", note: "n" }],
    ["a missing note", { decision: "rejected" }],
    ["a blank note", { decision: "rejected", note: "  " }],
    ["a note over 1000 characters", { decision: "rejected", note: "x".repeat(1001) }],
    ["adjusted without a score", { decision: "adjusted", note: "n" }],
    ["adjusted with a string score", { decision: "adjusted", note: "n", score: "80" }],
    ["adjusted with a negative score", { decision: "adjusted", note: "n", score: -1 }],
    ["adjusted with a score over 100", { decision: "adjusted", note: "n", score: 101 }],
    ["adjusted with a null score", { decision: "adjusted", note: "n", score: null }],
  ])("%s is a 400 and changes nothing", async (_name, body) => {
    const s = await withAppeal();
    expect((await decide(s, body)).status).toBe(400);
    expect(await revisionCount(s.submissionId)).toBe(1);
    const row = await env.DB.prepare("SELECT status FROM appeals WHERE id = ?").bind(s.appealId).first<any>();
    expect(row.status).toBe("open");
  });

  it("the boundary scores 0 and 100 are accepted", async () => {
    const lo = await withAppeal();
    const hi = await withAppeal();
    expect((await decide(lo, { decision: "adjusted", note: "n", score: 0 })).status).toBe(200);
    expect((await decide(hi, { decision: "adjusted", note: "n", score: 100 })).status).toBe(200);
  });
});

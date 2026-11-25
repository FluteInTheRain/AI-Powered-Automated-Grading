import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { client, fakeGrader, jsonRes } from "./helpers";

const RUBRIC = JSON.stringify({ correctness: 100 });
const call = client(fakeGrader(() => jsonRes({ ok: true })).binding);

async function seedBank(id: string) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric," +
      " reference_solution, test_cases, starter_code, created_at) VALUES (?, NULL, 'system', 'q','f','[]',?,'r','[]','c','2026-01-01T00:00:00Z')",
  ).bind(id, RUBRIC).run();
}

beforeAll(async () => {
  await seedBank("bank:e1");
  await seedBank("bank:e2");
});

const mkExam = (as: string, body: unknown) => call("POST", "/api/teacher/exams", { as, body });
const Q = (...ids: string[]) => ids.map((problem_id) => ({ problem_id }));

describe("teacher exams", () => {
  it("creates an exam with two questions and equal default weight", async () => {
    const r = await mkExam("ex1@x.com", { title: "Quiz", questions: Q("bank:e1", "bank:e2") });
    expect(r.status).toBe(200);
    expect(r.json.student_path).toBe(`/exam/${r.json.student_token}`);
    const d = await call("GET", `/api/teacher/exams/${r.json.id}`, { as: "ex1@x.com" });
    expect(d.json.questions.map((q: any) => [q.problem_id, q.weight, q.position])).toEqual([["bank:e1", 1, 0], ["bank:e2", 1, 1]]);
  });

  it.each([
    ["empty questions", { title: "T", questions: [] }],
    ["duplicate question", { title: "T", questions: Q("bank:e1", "bank:e1") }],
    ["zero weight", { title: "T", questions: [{ problem_id: "bank:e1", weight: 0 }] }],
    ["negative weight", { title: "T", questions: [{ problem_id: "bank:e1", weight: -1 }] }],
    ["non-finite weight", { title: "T", questions: [{ problem_id: "bank:e1", weight: "NaN" }] }],
    ["blank title", { title: "  ", questions: Q("bank:e1") }],
    ["title over 120 chars", { title: "x".repeat(121), questions: Q("bank:e1") }],
    ["bad deadline", { title: "T", deadline: "not a date", questions: Q("bank:e1") }],
  ])("rejects %s with 400", async (_n, body) => {
    expect((await mkExam("ex2@x.com", body)).status).toBe(400);
  });

  it("another teacher's private problem is 404", async () => {
    const p = await call("POST", "/api/teacher/problems", {
      as: "owner3@x.com",
      body: { statement: "s", func_name: "f", param_names: [], rubric: {}, reference_solution: "x", test_cases: [{}] },
    });
    const r = await mkExam("thief3@x.com", { title: "T", questions: Q(p.json.id) });
    expect(r.status).toBe(404);
    expect((await mkExam("owner3@x.com", { title: "T", questions: Q(p.json.id) })).status).toBe(200);
  });

  it("bank problem is allowed", async () => {
    expect((await mkExam("ex4@x.com", { title: "T", questions: Q("bank:e1") })).status).toBe(200);
  });

  it("another teacher's exam is 404", async () => {
    const r = await mkExam("ex5@x.com", { title: "T", questions: Q("bank:e1") });
    expect((await call("GET", `/api/teacher/exams/${r.json.id}`, { as: "other5@x.com" })).status).toBe(404);
    expect((await call("PATCH", `/api/teacher/exams/${r.json.id}`, { as: "other5@x.com", body: { deadline: null } })).status).toBe(404);
  });

  it("list returns only own exams, newest first", async () => {
    const a = await mkExam("ex6@x.com", { title: "first", questions: Q("bank:e1") });
    const b = await mkExam("ex6@x.com", { title: "second", questions: Q("bank:e1") });
    await mkExam("ex6other@x.com", { title: "x", questions: Q("bank:e1") });
    const l = await call("GET", "/api/teacher/exams", { as: "ex6@x.com" });
    expect(l.json.map((e: any) => e.id)).toEqual([b.json.id, a.json.id]);
  });

  it("patch sets and clears the deadline", async () => {
    const r = await mkExam("ex7@x.com", { title: "T", questions: Q("bank:e1") });
    const set = await call("PATCH", `/api/teacher/exams/${r.json.id}`, { as: "ex7@x.com", body: { deadline: "2030-01-01T00:00:00Z" } });
    expect(set.json.deadline).toBe("2030-01-01T00:00:00.000Z");
    const clr = await call("PATCH", `/api/teacher/exams/${r.json.id}`, { as: "ex7@x.com", body: { deadline: null } });
    expect(clr.json.deadline).toBeNull();
  });

  it("student token is 32 hex and unique", async () => {
    const a = await mkExam("ex8@x.com", { title: "T", questions: Q("bank:e1") });
    const b = await mkExam("ex8@x.com", { title: "T", questions: Q("bank:e1") });
    expect(a.json.student_token).toMatch(/^[0-9a-f]{32}$/);
    expect(a.json.student_token).not.toBe(b.json.student_token);
  });
});

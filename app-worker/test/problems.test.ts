import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getVisibleProblem } from "../src/db/problems";
import { upsertTeacher } from "../src/db/teachers";
import { client, fakeGrader, jsonRes } from "./helpers";

const RUBRIC = { correctness: 40, efficiency: 20, code_style: 20, edge_case_handling: 20 };
const NEW_PROBLEM = {
  title: "Add numbers", category: "Math", difficulty: "easy",
  statement: "Add two numbers", func_name: "add", param_names: ["a", "b"], rubric: RUBRIC,
  reference_solution: "def add(a, b):\n    return a + b\n",
  test_cases: [{ args: [1, 2], expected: 3, is_public: true }, { args: [2, 2], expected: 4, is_public: false }],
};

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric," +
      " reference_solution, test_cases, starter_code, created_at) VALUES ('bank:t7', NULL, 'system', 'Bank q','f','[\"x\"]',?,'SECRET REF','[{\"args\":[1],\"expected\":2,\"is_public\":false}]','c','2026-01-01T00:00:00Z')",
  ).bind(JSON.stringify(RUBRIC)).run();
});

describe("question bank and teacher problems", () => {
  it("bank lists system problems without secrets", async () => {
    const g = fakeGrader(() => jsonRes({}));
    const r = await client(g.binding)("GET", "/api/teacher/bank", { as: "bank@x.com" });
    expect(r.status).toBe(200);
    const q = r.json.find((p: any) => p.id === "bank:t7");
    expect(q).toMatchObject({ statement: "Bank q", func_name: "f" });
    expect(r.text).not.toContain("SECRET REF");
    expect(q).not.toHaveProperty("reference_solution");
    expect(q).not.toHaveProperty("test_cases");
  });

  it("a bank row without catalog columns lists with a fallback title, Other and medium", async () => {
    const r = await client(fakeGrader(() => jsonRes({})).binding)("GET", "/api/teacher/bank", { as: "fb@x.com" });
    expect(r.json.find((p: any) => p.id === "bank:t7")).toMatchObject({ title: "Bank q", category: "Other", difficulty: "medium" });
  });

  it("a bank row with catalog columns lists them", async () => {
    await env.DB.prepare(
      "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric, reference_solution, test_cases, starter_code, created_at, title, category, difficulty)" +
        " VALUES ('bank:t8', NULL, 'system', 'S','f','[]','{}','r','[]','c','2026-01-01T00:00:00Z','Two Sum','Arrays & Search','medium')").run();
    const r = await client(fakeGrader(() => jsonRes({})).binding)("GET", "/api/teacher/bank", { as: "fb2@x.com" });
    expect(r.json.find((p: any) => p.id === "bank:t8")).toMatchObject({ title: "Two Sum", category: "Arrays & Search", difficulty: "medium" });
  });

  it("an own problem lists its title, category and difficulty", async () => {
    const call = client(fakeGrader(() => jsonRes({ ok: true })).binding);
    await call("POST", "/api/teacher/problems", { as: "meta1@x.com", body: { ...NEW_PROBLEM, title: "My title", category: "My topic", difficulty: "hard" } });
    const list = await call("GET", "/api/teacher/problems", { as: "meta1@x.com" });
    expect(list.json[0]).toMatchObject({ title: "My title", category: "My topic", difficulty: "hard" });
  });

  it.each([
    ["missing title", { ...NEW_PROBLEM, title: undefined }],
    ["blank title", { ...NEW_PROBLEM, title: "   " }],
    ["81-char title", { ...NEW_PROBLEM, title: "x".repeat(81) }],
    ["non-string title", { ...NEW_PROBLEM, title: 5 }],
    ["missing category", { ...NEW_PROBLEM, category: undefined }],
    ["41-char category", { ...NEW_PROBLEM, category: "x".repeat(41) }],
    ["unknown difficulty", { ...NEW_PROBLEM, difficulty: "expert" }],
    ["missing difficulty", { ...NEW_PROBLEM, difficulty: undefined }],
  ])("rejects %s before the grader", async (_n, body) => {
    const g = fakeGrader(() => jsonRes({ ok: true }));
    const r = await client(g.binding)("POST", "/api/teacher/problems", { as: "meta2@x.com", body });
    expect(r.status).toBe(400);
    expect(g.calls.length).toBe(0);
  });

  it("create problem calls validate then inserts as private", async () => {
    const g = fakeGrader(() => jsonRes({ ok: true }));
    const call = client(g.binding);
    const r = await call("POST", "/api/teacher/problems", { as: "own1@x.com", body: NEW_PROBLEM });
    expect(r.status).toBe(200);
    expect(g.calls[0].name).toBe("validate-problem");
    const row = await env.DB.prepare("SELECT visibility, owner_teacher_id, starter_code FROM problems WHERE id = ?").bind(r.json.id).first<any>();
    expect(row.visibility).toBe("private");
    expect(row.starter_code).toContain("def add(a, b):");
    const me = await upsertTeacher(env.DB, "own1@x.com");
    expect(row.owner_teacher_id).toBe(me.id);
  });

  it("teacher sees only own private problems", async () => {
    const g = fakeGrader(() => jsonRes({ ok: true }));
    const call = client(g.binding);
    const mine = await call("POST", "/api/teacher/problems", { as: "a7@x.com", body: NEW_PROBLEM });
    const listA = await call("GET", "/api/teacher/problems", { as: "a7@x.com" });
    const listB = await call("GET", "/api/teacher/problems", { as: "b7@x.com" });
    expect(listA.json.map((p: any) => p.id)).toContain(mine.json.id);
    expect(listB.json.map((p: any) => p.id)).not.toContain(mine.json.id);
  });

  it("validation 400 is passed through and nothing is inserted", async () => {
    const g = fakeGrader(() => jsonRes({ detail: "Rubric weights must sum to 100, got 90" }, 400));
    const before = await env.DB.prepare("SELECT count(*) AS n FROM problems").first<any>();
    const r = await client(g.binding)("POST", "/api/teacher/problems", { as: "v7@x.com", body: NEW_PROBLEM });
    expect(r.status).toBe(400);
    expect(r.json.detail).toContain("Rubric weights");
    const after = await env.DB.prepare("SELECT count(*) AS n FROM problems").first<any>();
    expect(after.n).toBe(before.n);
  });

  it("grader outage is 502 with a fixed text", async () => {
    const g = fakeGrader(() => jsonRes({ detail: "internal stack trace here" }, 500));
    const r = await client(g.binding)("POST", "/api/teacher/problems", { as: "o7@x.com", body: NEW_PROBLEM });
    expect(r.status).toBe(502);
    expect(r.json.detail).toBe("Grading service error, please try again.");
  });

  it("malformed body is 400 and never reaches the grader", async () => {
    const g = fakeGrader(() => jsonRes({ ok: true }));
    const r = await client(g.binding)("POST", "/api/teacher/problems", { as: "m7@x.com", body: { statement: "x" } });
    expect(r.status).toBe(400);
    expect(g.calls.length).toBe(0);
  });

  it.each([
    ["string is_public", { ...NEW_PROBLEM, test_cases: [{ args: [1, 2], expected: 3, is_public: "false" }, { args: [2, 2], expected: 4, is_public: false }] }],
    ["args not a list", { ...NEW_PROBLEM, test_cases: [{ args: "1,2", expected: 3, is_public: false }] }],
    ["string rubric weight", { ...NEW_PROBLEM, rubric: { ...RUBRIC, correctness: "40" } }],
    ["extra rubric key", { ...NEW_PROBLEM, rubric: { ...RUBRIC, bonus: 0 } }],
    ["bad param name", { ...NEW_PROBLEM, param_names: ["a b"] }],
  ])("strictly rejects %s before the grader", async (_n, body) => {
    const g = fakeGrader(() => jsonRes({ ok: true }));
    const r = await client(g.binding)("POST", "/api/teacher/problems", { as: "strict@x.com", body });
    expect(r.status).toBe(400);
    expect(g.calls.length).toBe(0);
  });

  it("preview is proxied to the grader", async () => {
    const g = fakeGrader(() => jsonRes({ status: "ok", cases: [] }));
    const r = await client(g.binding)("POST", "/api/teacher/problems/preview", { as: "p7@x.com", body: { reference_solution: "x", func_name: "f", cases: [] } });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("ok");
    expect(g.calls[0].name).toBe("preview");
  });

  it("another teacher's private problem is not visible, bank and own are", async () => {
    const g = fakeGrader(() => jsonRes({ ok: true }));
    const mine = await client(g.binding)("POST", "/api/teacher/problems", { as: "own8@x.com", body: NEW_PROBLEM });
    const owner = await upsertTeacher(env.DB, "own8@x.com");
    const other = await upsertTeacher(env.DB, "other8@x.com");
    expect(await getVisibleProblem(env.DB, other.id, mine.json.id)).toBeNull();
    expect(await getVisibleProblem(env.DB, owner.id, mine.json.id)).not.toBeNull();
    expect(await getVisibleProblem(env.DB, other.id, "bank:t7")).not.toBeNull();
  });
});

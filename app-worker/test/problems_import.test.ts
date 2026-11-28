import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { upsertTeacher } from "../src/db/teachers";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ITEMS } from "../src/routes/teacher_problems";
import { client, fakeGrader, jsonRes } from "./helpers";

const item = (title: string, extra: Record<string, unknown> = {}) => ({
  title, category: "Math", difficulty: "easy", statement: "Add two numbers", func_name: "add", param_names: ["a", "b"],
  reference_solution: "def add(a, b):\n    return a + b\n",
  test_cases: [{ args: [1, 2], expected: 3, is_public: true }], ...extra,
});
const count = async (who: string) => {
  const t = await upsertTeacher(env.DB, who);
  return (await env.DB.prepare("SELECT count(*) AS n FROM problems WHERE owner_teacher_id = ?").bind(t.id).first<any>()).n as number;
};
const ok = () => fakeGrader(() => jsonRes({ ok: true }));

describe("bulk import", () => {
  it("imports a valid file in one go, as private problems owned by the caller", async () => {
    const g = ok();
    const r = await client(g.binding)("POST", "/api/teacher/problems/import", { as: "imp1@x.com", body: { problems: [item("A"), item("B")] } });
    expect(r.status).toBe(200);
    expect(r.json.imported).toBe(2);
    expect(g.calls.map((c) => c.name)).toEqual(["validate-problem", "validate-problem"]);
    expect(await count("imp1@x.com")).toBe(2);
    const list = await client(g.binding)("GET", "/api/teacher/problems", { as: "imp1@x.com" });
    expect(list.json.map((p: any) => p.title).sort()).toEqual(["A", "B"]);
  });

  it("one invalid item: per-item error with index and field, nothing inserted", async () => {
    const g = ok();
    const r = await client(g.binding)("POST", "/api/teacher/problems/import", {
      as: "imp2@x.com", body: { problems: [item("Good"), item("Bad", { func_name: "1x" }), item("Bad2", { difficulty: "expert" })] },
    });
    expect(r.status).toBe(400);
    expect(r.json.errors).toEqual([
      { index: 1, field: "func_name", message: expect.any(String) },
      { index: 2, field: "difficulty", message: expect.any(String) },
    ]);
    expect(await count("imp2@x.com")).toBe(0);
  });

  it("a test-suite rejection from the grader is reported on that item and nothing is inserted", async () => {
    const g = fakeGrader((_n, body) => (body.title === "Weak" ? jsonRes({ detail: "Reference fails case 1" }, 400) : jsonRes({ ok: true })));
    const r = await client(g.binding)("POST", "/api/teacher/problems/import", { as: "imp3@x.com", body: [item("Fine"), item("Weak")] });
    expect(r.status).toBe(400);
    expect(r.json.errors).toEqual([{ index: 1, field: "test_cases", message: "Reference fails case 1" }]);
    expect(await count("imp3@x.com")).toBe(0);
  });

  it("duplicate titles, in the file or against existing problems, are errors", async () => {
    const call = client(ok().binding);
    await call("POST", "/api/teacher/problems/import", { as: "imp4@x.com", body: { problems: [item("Existing")] } });
    const r = await call("POST", "/api/teacher/problems/import", { as: "imp4@x.com", body: { problems: [item("Twin"), item("twin"), item("EXISTING")] } });
    expect(r.status).toBe(400);
    expect(r.json.errors.map((e: any) => [e.index, e.field])).toEqual([[1, "title"], [2, "title"]]);
    expect(await count("imp4@x.com")).toBe(1);
  });

  it("another teacher's titles do not collide", async () => {
    const call = client(ok().binding);
    await call("POST", "/api/teacher/problems/import", { as: "imp5a@x.com", body: { problems: [item("Shared")] } });
    const r = await call("POST", "/api/teacher/problems/import", { as: "imp5b@x.com", body: { problems: [item("Shared")] } });
    expect(r.status).toBe(200);
  });

  it("oversize file is 413 and never reaches the grader", async () => {
    const g = ok();
    const big = { problems: [item("Big", { statement: "x".repeat(IMPORT_MAX_BYTES) })] };
    const r = await client(g.binding)("POST", "/api/teacher/problems/import", { as: "imp6@x.com", body: big });
    expect(r.status).toBe(413);
    expect(g.calls.length).toBe(0);
  });

  it("too many items is 413", async () => {
    const g = ok();
    const many = Array.from({ length: IMPORT_MAX_ITEMS + 1 }, (_, i) => item(`P${i}`));
    const r = await client(g.binding)("POST", "/api/teacher/problems/import", { as: "imp7@x.com", body: { problems: many } });
    expect(r.status).toBe(413);
    expect(g.calls.length).toBe(0);
  });

  it.each([["a bare string", "oops"], ["empty list", { problems: [] }], ["wrong shape", { x: 1 }]])("%s is 400", async (_n, body) => {
    const r = await client(ok().binding)("POST", "/api/teacher/problems/import", { as: "imp8@x.com", body });
    expect(r.status).toBe(400);
  });

  it("grader outage aborts with 502 and inserts nothing", async () => {
    const r = await client(fakeGrader(() => jsonRes({ detail: "boom" }, 500)).binding)("POST", "/api/teacher/problems/import", { as: "imp9@x.com", body: { problems: [item("A")] } });
    expect(r.status).toBe(502);
    expect(await count("imp9@x.com")).toBe(0);
  });
});

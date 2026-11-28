import { describe, expect, it } from "vitest";
import { describeSurvivor } from "../src/check_tests";
import { CHECK_MAX_CASES, CHECK_MAX_CODE_CHARS } from "../src/problem_input";
import { client, fakeGrader, jsonRes } from "./helpers";

const body = {
  func_name: "f", reference_solution: "def f(x):\n    return x < 3\n",
  test_cases: [{ args: [1], expected: true, is_public: true }, { args: [5], expected: false, is_public: false }],
};
const report = {
  total: 4, generated: 9, capped: true, killed: 2, score: 0.5, weak: true, weak_threshold: 0.8,
  survivors: [{ kind: "comparison", description: "line 2: changed `<` to `<=` in `x <= 3`" }],
};
const URL = "/api/teacher/problems/check-tests";

describe("POST /problems/check-tests", () => {
  it("needs a teacher", async () => {
    const g = fakeGrader(() => jsonRes(report));
    const r = await client(g.binding)("POST", URL, { body });
    expect(r.status).toBe(401);
    expect(g.calls).toHaveLength(0);
  });

  it("sends only the three fields to the grader and answers in plain words, with capped passed through", async () => {
    const g = fakeGrader(() => jsonRes(report));
    const r = await client(g.binding)("POST", URL, { as: "ck1@x.com", body: { ...body, statement: "ignored", title: "x" } });
    expect(r.status).toBe(200);
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0].name).toBe("check-tests");
    expect(Object.keys(g.calls[0].body).sort()).toEqual(["func_name", "reference_solution", "test_cases"]);
    expect(r.json).toMatchObject({ score: 0.5, killed: 2, total: 4, generated: 9, capped: true, weak: true });
    expect(r.json.survivors).toEqual(["Bản sửa đổi `<` thành `<=` , thành ra `x <= 3` (dòng 2) vẫn qua hết test: hãy thêm test cho trường hợp biên."]);
    expect(r.json.note).toContain("ước lượng");
    expect(r.json.note).toContain("y hệt");
  });

  it.each([
    ["not an object", [1]],
    ["bad func_name", { ...body, func_name: "1x" }],
    ["no reference", { ...body, reference_solution: " " }],
    ["no tests", { ...body, test_cases: [] }],
    ["test without is_public", { ...body, test_cases: [{ args: [1], expected: 1 }] }],
    ["reference too long", { ...body, reference_solution: "#".repeat(CHECK_MAX_CODE_CHARS + 1) }],
    ["too many tests", { ...body, test_cases: Array(CHECK_MAX_CASES + 1).fill(body.test_cases[0]) }],
  ])("rejects %s with 400 and never calls the grader", async (_n, b) => {
    const g = fakeGrader(() => jsonRes(report));
    const r = await client(g.binding)("POST", URL, { as: "ck2@x.com", body: b });
    expect(r.status).toBe(400);
    expect(g.calls).toHaveLength(0);
  });

  it("is rate limited per teacher", async () => {
    const g = fakeGrader(() => jsonRes(report));
    const keys: string[] = [];
    const RL_CHECK = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: false }; } };
    const r = await client(g.binding, undefined, undefined, { RL_CHECK })("POST", URL, { as: "ck3@x.com", body });
    expect(r.status).toBe(429);
    expect(g.calls).toHaveLength(0);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^check-tests:/);
  });

  it("passes a 400 from the grader through and hides other grader failures", async () => {
    const bad = await client(fakeGrader(() => jsonRes({ detail: "The reference solution does not pass its own tests." }, 400)).binding)("POST", URL, { as: "ck4@x.com", body });
    expect(bad.status).toBe(400);
    expect(bad.json.detail).toContain("own tests");
    const boom = await client(fakeGrader(() => jsonRes({ detail: "secret internals" }, 500)).binding)("POST", URL, { as: "ck4@x.com", body });
    expect(boom.status).toBe(502);
    expect(boom.text).not.toContain("secret");
  });

  it("explains an empty and a clean run", async () => {
    const none = await client(fakeGrader(() => jsonRes({ ...report, total: 0, generated: 0, capped: false, killed: 0, score: null, weak: false, survivors: [] })).binding)("POST", URL, { as: "ck5@x.com", body });
    expect(none.json.score).toBeNull();
    expect(none.json.note).toContain("chưa đánh giá được");
    const clean = await client(fakeGrader(() => jsonRes({ ...report, capped: false, generated: 4, killed: 4, score: 1, weak: false, survivors: [] })).binding)("POST", URL, { as: "ck5@x.com", body });
    expect(clean.json.weak).toBe(false);
    expect(clean.json.note).not.toContain("ước lượng");
    expect(clean.json.note).not.toContain("y hệt");
  });
});

describe("describeSurvivor", () => {
  it.each([
    ["and_or", "line 4: swapped `and` for `or`", "đổi `and` thành `or` (dòng 4)"],
    ["arithmetic", "line 3: replaced `+` with `-`", "thay `+` bằng `-` (dòng 3)"],
    ["range_bound", "line 2: range upper bound off by one (+1) in `range(n)`", "cộng thêm 1 ở cận trên của `range(n)` (dòng 2)"],
    ["wrong_end_element", "line 2: last-element access `[-1]` returns `[-2]` instead", "lấy phần tử `[-2]` thay cho `[-1]` (dòng 2)"],
    ["wrong_return", "line 5: `return True` flipped to `return False`", "đổi `return True` thành `return False` (dòng 5)"],
    ["drop_guard", "line 2: removed the guard `if n < 0: ...` (early return/raise)", "bỏ đoạn kiểm tra `if n < 0` (dòng 2)"],
    ["off_by_one", "line 2: integer literal 3 changed to 4", "đổi số `3` thành `4` (dòng 2)"],
  ])("%s", (kind, description, fragment) => {
    const t = describeSurvivor({ kind, description });
    expect(t).toContain(fragment);
    expect(t).toContain("vẫn qua hết test");
  });

  it("falls back to the raw description for an unknown shape", () => {
    expect(describeSurvivor({ kind: "new_kind", description: "something odd" })).toContain("something odd");
  });
});

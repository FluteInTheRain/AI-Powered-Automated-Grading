import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { findSimilarPairs, jaccard, normalize, shingles } from "../src/similarity";
import { seedGradedAttempt } from "./appeals_fixture";

const STARTER = "def f(nums, target):\n    pass";
const REF = "def f(nums, target):\n    return 0";

const TWO_SUM = `
def two_sum(nums, target):
    # remember where each value was seen
    seen = {}
    for i, n in enumerate(nums):
        need = target - n
        if need in seen:
            return [seen[need], i]
        seen[n] = i
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                return [i, j]
    return []
`;
const RENAMED = `
def solve(values, goal):
    """Find the pair."""
    memo = {}
    for idx, v in enumerate(values):
        rest = goal - v
        if rest in memo:
            return [memo[rest], idx]
        memo[v] = idx
    for a in range(len(values)):
        for b in range(a + 1, len(values)):
            if values[a] + values[b] == goal:
                return [a, b]
    return []
`;
const DIFFERENT = `
def f(nums, target):
    pairs = sorted((v, k) for k, v in enumerate(nums))
    lo, hi = 0, len(pairs) - 1
    while lo < hi:
        total = pairs[lo][0] + pairs[hi][0]
        if total == target:
            return sorted([pairs[lo][1], pairs[hi][1]])
        elif total < target:
            lo += 1
        else:
            hi -= 1
    result = []
    for item in pairs:
        if item[0] > target:
            result.append(item[1])
    return result[:2]
`;

const sim = (subs: Record<string, string>) =>
  findSimilarPairs(Object.entries(subs).map(([id, code]) => ({ id, code })), STARTER, REF);

describe("normalize", () => {
  it("drops comments and whitespace and renames identifiers, strings and numbers", () => {
    expect(normalize("x = foo(1, 'a')  # note")).toEqual(["ID", "=", "ID", "(", "NUM", ",", "STR", ")"]);
    expect(normalize("def a(b):\n    return len(b)")).toEqual(["def", "ID", "(", "ID", ")", ":", "return", "len", "(", "ID", ")"]);
  });
  it("does not choke on an unterminated string", () => {
    expect(() => normalize("x = 'abc")).not.toThrow();
  });
});

describe("findSimilarPairs", () => {
  it("flags identical code", () => {
    const r = sim({ a: TWO_SUM, b: TWO_SUM });
    expect(r.pairs).toEqual([{ a: "a", b: "b", similarity: 1 }]);
  });

  it("flags a copy with renamed variables, new comments and different spacing", () => {
    const r = sim({ a: TWO_SUM, b: RENAMED });
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].similarity).toBeGreaterThanOrEqual(0.85);
  });

  it("does not flag genuinely different solutions", () => {
    const r = sim({ a: TWO_SUM, b: DIFFERENT });
    expect(r.compared).toBe(2);
    expect(r.pairs).toEqual([]);
    expect(jaccard(shingles(normalize(TWO_SUM)), shingles(normalize(DIFFERENT)))).toBeLessThan(0.5);
  });

  it("never flags short trivial solutions, even when identical", () => {
    const r = sim({ a: "def f(a, b):\n    return a + b", b: "def f(a, b):\n    return a + b" });
    expect(r).toMatchObject({ compared: 0, skipped: 2, pairs: [] });
  });

  it("ignores the starter code every student begins with", () => {
    const r = sim({ a: STARTER, b: STARTER });
    expect(r).toMatchObject({ compared: 0, pairs: [] });
  });

  it("skips submissions that equal the reference solution (the common answer)", () => {
    const r = findSimilarPairs([{ id: "a", code: TWO_SUM }, { id: "b", code: TWO_SUM }], STARTER, TWO_SUM);
    expect(r).toMatchObject({ compared: 0, skipped: 2, pairs: [] });
  });
});

describe("GET /api/teacher/exams/:id/similarity", () => {
  it("is empty for one student and hides another teacher's exam", async () => {
    const f = await seedGradedAttempt({ code: TWO_SUM });
    const ok = await f.call("GET", `/api/teacher/exams/${f.examId}/similarity`, { as: f.teacher });
    expect(ok.status).toBe(200);
    expect(ok.json.questions[0]).toMatchObject({ problem_id: f.problemId, compared: 1, pairs: [] });
    const other = await f.call("GET", `/api/teacher/exams/${f.examId}/similarity`, { as: "someone-else@x.com" });
    expect(other.status).toBe(404);
  });

  it("lists a renamed copy with both student names and leaves scores untouched", async () => {
    const f = await seedGradedAttempt({ code: TWO_SUM, name: "An" });
    // second student on the same exam
    const att = await f.call("POST", `/api/exam/${f.token}/attempts`, { body: { student_name: "Binh" } });
    await env.DB.prepare("INSERT INTO submissions (id, attempt_id, problem_id, code, submitted_at) VALUES ('s2', ?, ?, ?, '2026-11-28T00:00:00Z')")
      .bind(att.json.attempt_id, f.problemId, RENAMED).run();
    const before = await env.DB.prepare("SELECT count(*) AS n, sum(score) AS s FROM score_revisions").first<any>();
    const res = await f.call("GET", `/api/teacher/exams/${f.examId}/similarity`, { as: f.teacher });
    const pair = res.json.questions[0].pairs[0];
    expect([pair.a.student_name, pair.b.student_name].sort()).toEqual(["An", "Binh"]);
    expect(res.json.threshold).toBe(0.85);
    const after = await env.DB.prepare("SELECT count(*) AS n, sum(score) AS s FROM score_revisions").first<any>();
    expect(after).toEqual(before);
  });
});

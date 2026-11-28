import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { BANDS, MIN_ATTEMPTS, calibrate, classifyInterval, wilson } from "../src/difficulty";
import { client, countingDb, fakeGrader, jsonRes } from "./helpers";

describe("wilson", () => {
  it("matches a known value", () => {
    const { lo, hi } = wilson(5, 10);
    expect(lo).toBeCloseTo(0.2366, 3);
    expect(hi).toBeCloseTo(0.7634, 3);
  });
  it("stays inside [0, 1] and is not degenerate at 0% and 100%", () => {
    const zero = wilson(0, 20);
    expect(zero.lo).toBe(0);
    expect(zero.hi).toBeGreaterThan(0.1);
    expect(zero.hi).toBeLessThan(0.2);
    const all = wilson(20, 20);
    expect(all.hi).toBe(1);
    expect(all.lo).toBeGreaterThan(0.8);
  });
  it("narrows as n grows", () => {
    const a = wilson(15, 30), b = wilson(150, 300);
    expect(b.hi - b.lo).toBeLessThan(a.hi - a.lo);
  });
});

describe("classifyInterval", () => {
  it("never flags below the minimum, even at 0 of n and n of n", () => {
    expect(calibrate("hard", MIN_ATTEMPTS - 1, MIN_ATTEMPTS - 1).verdict).toBe("insufficient");
    expect(calibrate("medium", 0, MIN_ATTEMPTS - 1).verdict).toBe("insufficient");
    expect(calibrate("hard", 0, 0)).toEqual({ pass_rate: null, ci_low: null, ci_high: null, verdict: "insufficient" });
  });
  it("flags a hard problem everybody passes as easier than its label", () => {
    expect(calibrate("hard", 20, 20).verdict).toBe("easier");
    expect(calibrate("medium", 30, 30).verdict).toBe("easier");
  });
  it("flags an easy or medium problem nobody passes as harder than its label", () => {
    expect(calibrate("easy", 0, 20).verdict).toBe("harder");
    expect(calibrate("medium", 0, 20).verdict).toBe("harder");
  });
  it("cannot say an easy problem is easier or a hard one harder", () => {
    expect(calibrate("easy", 20, 20).verdict).toBe("match");
    expect(calibrate("hard", 0, 20).verdict).toBe("match");
  });
  it("does not flag when the interval overlaps the band, even if the point estimate is outside", () => {
    // 12 of 20 = 60% on a hard problem; the interval still reaches below the band's upper edge 0.5.
    expect(calibrate("hard", 12, 20).verdict).toBe("match");
  });
  it("treats an interval touching a band edge as inside", () => {
    expect(classifyInterval("hard", { lo: BANDS.hard.max, hi: 1 }, 50)).toBe("match");
    expect(classifyInterval("hard", { lo: BANDS.hard.max + 1e-9, hi: 1 }, 50)).toBe("easier");
    expect(classifyInterval("easy", { lo: 0, hi: BANDS.easy.min }, 50)).toBe("match");
    expect(classifyInterval("easy", { lo: 0, hi: BANDS.easy.min - 1e-9 }, 50)).toBe("harder");
  });
  it("is exactly at the minimum", () => {
    expect(classifyInterval("hard", { lo: 0.9, hi: 1 }, MIN_ATTEMPTS)).toBe("easier");
    expect(classifyInterval("hard", { lo: 0.9, hi: 1 }, MIN_ATTEMPTS - 1)).toBe("insufficient");
  });
  it("reports a missing or unknown label", () => {
    expect(classifyInterval(null, { lo: 0, hi: 1 }, 100)).toBe("no_label");
    expect(classifyInterval("legendary", { lo: 0, hi: 1 }, 100)).toBe("no_label");
  });
});

const call = client(fakeGrader(async () => jsonRes({})).binding);
let seq = 0;
const FAIL = { pass_count: 1, total: 2 }, PASS = { pass_count: 2, total: 2 };

async function teacherId(email: string) {
  await call("GET", "/api/teacher/me", { as: email });
  return (await env.DB.prepare("SELECT id FROM teachers WHERE email = ?").bind(email).first<{ id: string }>())!.id;
}

type Item = { name?: string; exec?: { pass_count: number; total: number } | null; score?: number; code?: string; job?: string | null; adjusted?: number; at?: string };

/** One problem in one new exam of `teacher` (or a new exam on an existing problem), one submission per item. */
async function seed(teacher: string, difficulty: string | null, items: Item[], existingProblem?: string) {
  const tid = await teacherId(teacher);
  const n = ++seq;
  const problemId = existingProblem ?? `dp${n}`, examId = `de${n}`;
  const st: D1PreparedStatement[] = [];
  const ins = (sql: string, ...b: unknown[]) => st.push(env.DB.prepare(sql).bind(...b));
  if (!existingProblem) {
    ins("INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric, reference_solution, test_cases, starter_code, created_at, title, difficulty)" +
      " VALUES (?, NULL, 'system', 's', 'f', '[]', '{}', 'r', '[]', 'def f(x): pass', '2026-01-01T00:00:00Z', ?, ?)", problemId, `Title ${problemId}`, difficulty);
  }
  ins("INSERT INTO exams (id, teacher_id, title, student_token, time_limit_seconds, created_at) VALUES (?, ?, 'E', ?, 600, '2026-01-01T00:00:00Z')", examId, tid, `tok-${examId}`);
  ins("INSERT INTO exam_questions (exam_id, problem_id, position, weight) VALUES (?, ?, 0, 1)", examId, problemId);
  items.forEach((it, i) => {
    const id = `${examId}-${i}`, name = it.name ?? `s${i}`;
    ins("INSERT INTO attempts (id, exam_id, student_name, receipt_code, started_at, name_key) VALUES (?, ?, ?, ?, '2026-01-02T00:00:00Z', ?)", `a-${id}`, examId, name, `rc-${id}`, name.toLowerCase());
    ins("INSERT INTO submissions (id, attempt_id, problem_id, code, submitted_at) VALUES (?, ?, ?, ?, ?)", `s-${id}`, `a-${id}`, problemId, it.code ?? "def f(x): return 1", it.at ?? "2026-01-02T00:10:00Z");
    const exec = it.exec === undefined ? PASS : it.exec;
    const detail = JSON.stringify(exec === null ? {} : { execution_result: { ...exec, status: "ran", errors: [] } });
    ins("INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, created_at) VALUES (?, ?, 0, 'ai', ?, '{}', ?, 'ai', '2026-01-02T00:11:00Z')", `r0-${id}`, `s-${id}`, it.score ?? 100, detail);
    if (it.adjusted !== undefined) ins("INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, created_at) VALUES (?, ?, 1, 'teacher', ?, '{}', '{}', 't', '2026-01-03T00:00:00Z')", `r1-${id}`, `s-${id}`, it.adjusted);
    if (it.job !== null) ins("INSERT INTO grading_jobs (submission_id, status, updated_at) VALUES (?, ?, '2026-01-02T00:11:00Z')", `s-${id}`, it.job ?? "done");
  });
  await env.DB.batch(st);
  return { problemId, examId };
}

const many = (k: number, make: (i: number) => Item): Item[] => Array.from({ length: k }, (_, i) => make(i));
const get = async (as: string) => (await call("GET", "/api/teacher/difficulty-calibration", { as })).json;
const row = (j: any, id: string) => j.problems.find((p: any) => p.problem_id === id);

describe("GET /api/teacher/difficulty-calibration", () => {
  it("requires teacher auth", async () => {
    expect((await call("GET", "/api/teacher/difficulty-calibration")).status).toBe(401);
  });

  it("computes n, pass rate, mean score and a verdict", async () => {
    const t = `c${++seq}@x.com`;
    const { problemId } = await seed(t, "hard", many(25, (i) => (i < 24 ? { score: 100 } : { exec: FAIL, score: 50 })));
    const j = await get(t);
    expect(j.min_attempts).toBe(MIN_ATTEMPTS);
    const p = row(j, problemId);
    expect(p).toMatchObject({ title: `Title ${problemId}`, difficulty: "hard", n: 25, verdict: "easier" });
    expect(p.pass_rate).toBeCloseTo(24 / 25);
    expect(p.mean_score).toBeCloseTo((24 * 100 + 50) / 25);
    expect(p.ci_low).toBeGreaterThan(0.5);
  });

  it("says not enough data below the minimum", async () => {
    const t = `c${++seq}@x.com`;
    const { problemId } = await seed(t, "hard", many(19, () => ({})));
    expect(row(await get(t), problemId)).toMatchObject({ n: 19, verdict: "insufficient" });
  });

  it("lists a used problem with no attempts as n = 0", async () => {
    const t = `c${++seq}@x.com`;
    const { problemId } = await seed(t, "easy", []);
    expect(row(await get(t), problemId)).toMatchObject({ n: 0, pass_rate: null, mean_score: null, verdict: "insufficient" });
  });

  it("uses the latest revision for the mean score but revision 0 for passing", async () => {
    const t = `c${++seq}@x.com`;
    const { problemId } = await seed(t, "medium", [{ exec: FAIL, score: 40, adjusted: 90 }]);
    const p = row(await get(t), problemId);
    expect(p.mean_score).toBe(90);
    expect(p.pass_rate).toBe(0);
  });

  it("leaves out blank answers, ungraded, failed and unreadable items", async () => {
    const t = `c${++seq}@x.com`;
    const { problemId } = await seed(t, "medium", [
      { name: "ok" },
      { name: "blank", code: "  def f(x): pass \n", exec: { pass_count: 0, total: 2 }, score: 0 },
      { name: "queued", job: "queued" },
      { name: "grading", job: "grading" },
      { name: "failed", job: "failed", exec: null, score: 0 },
      { name: "noexec", exec: null },
    ]);
    expect(row(await get(t), problemId)).toMatchObject({ n: 1, pass_rate: 1 });
  });

  it("counts a Phase 1 submission with a score and no job row", async () => {
    const t = `c${++seq}@x.com`;
    const { problemId } = await seed(t, "medium", [{ job: null }]);
    expect(row(await get(t), problemId).n).toBe(1);
  });

  it("counts a student once per problem across the teacher's exams, using the first submission", async () => {
    const t = `c${++seq}@x.com`;
    const first = await seed(t, "medium", [{ name: "An", exec: FAIL, at: "2026-01-02T00:10:00Z" }, { name: "Binh" }]);
    await seed(t, "medium", [{ name: "AN", at: "2026-02-02T00:10:00Z" }], first.problemId);
    const p = row(await get(t), first.problemId);
    expect(p.n).toBe(2);
    expect(p.pass_rate).toBe(0.5);
  });

  it("does not leak another teacher's attempts or problems", async () => {
    const a = `c${++seq}@x.com`, b = `c${++seq}@x.com`;
    const mine = await seed(a, "hard", many(3, () => ({})));
    const theirs = await seed(b, "hard", many(25, () => ({})));
    await seed(b, null, many(21, () => ({})), mine.problemId); // b uses a's problem too
    const ja = await get(a), jb = await get(b);
    expect(row(ja, theirs.problemId)).toBeUndefined();
    expect(row(ja, mine.problemId).n).toBe(3);
    expect(row(jb, mine.problemId).n).toBe(21);
    expect(row(jb, theirs.problemId).n).toBe(25);
  });

  it("runs the calibration as a single statement", async () => {
    const t = `c${++seq}@x.com`;
    await seed(t, "easy", [{}]);
    const { db, count } = countingDb(env.DB);
    const c2 = client(fakeGrader(async () => jsonRes({})).binding, undefined, db);
    await c2("GET", "/api/teacher/me", { as: t });
    const authOnly = count();
    expect((await c2("GET", "/api/teacher/difficulty-calibration", { as: t })).status).toBe(200);
    expect(count() - authOnly).toBe(authOnly + 1); // same auth cost as /me, plus exactly one statement
  });
});

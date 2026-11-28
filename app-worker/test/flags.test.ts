import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURES, featureMap, isEnabled, parseDisabled, resetWarned } from "../src/flags";
import { seedGradedAttempt } from "./appeals_fixture";
import { client, countingDb, fakeGrader, fakeQueue, jsonRes } from "./helpers";

afterEach(() => { vi.restoreAllMocks(); resetWarned(); });

describe("parseDisabled", () => {
  it("empty or missing disables nothing", () => {
    for (const raw of ["", "   ", ",", " , ,", undefined]) {
      expect(parseDisabled(raw)).toEqual({ disabled: new Set(), unknown: [] });
    }
  });
  it("ignores spaces and case", () => {
    expect(parseDisabled("  Similarity ,CSV_EXPORT,\tappeals ").disabled).toEqual(new Set(["similarity", "csv_export", "appeals"]));
  });
  it("collapses duplicates", () => {
    const r = parseDisabled("appeals,APPEALS, appeals,nope,Nope");
    expect(r.disabled).toEqual(new Set(["appeals"]));
    expect(r.unknown).toEqual(["nope"]);
  });
  it("returns unknown names apart and keeps the known ones", () => {
    const r = parseDisabled("bulk_import,csv-export,export");
    expect(r.disabled).toEqual(new Set(["bulk_import"]));
    expect(r.unknown).toEqual(["csv-export", "export"]);
  });
});

describe("isEnabled", () => {
  it("everything is on by default", () => {
    for (const f of FEATURES) expect(isEnabled({}, f)).toBe(true);
    expect(featureMap({ DISABLED_FEATURES: "" })).toEqual({ similarity: true, csv_export: true, bulk_import: true, appeals: true });
  });
  it("only the named feature goes off", () => {
    const env = { DISABLED_FEATURES: "csv_export" };
    expect(isEnabled(env, "csv_export")).toBe(false);
    expect(isEnabled(env, "similarity")).toBe(true);
  });
  it("warns once per unknown name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { DISABLED_FEATURES: "typo,similarity" };
    isEnabled(env, "appeals"); isEnabled(env, "appeals"); featureMap(env);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("typo");
  });
});

describe("GET /api/teacher/me features", () => {
  const me = (extra: Record<string, unknown>) => client(fakeGrader(() => jsonRes({})).binding, undefined, undefined, extra)("GET", "/api/teacher/me", { as: "f@x.com" });
  it("reports all on by default", async () => {
    expect((await me({})).json.features).toEqual({ similarity: true, csv_export: true, bulk_import: true, appeals: true });
  });
  it("reports the disabled ones as false", async () => {
    expect((await me({ DISABLED_FEATURES: "Similarity, appeals,zzz" })).json.features).toEqual({ similarity: false, csv_export: true, bulk_import: true, appeals: false });
  });
});

describe("kill switch middleware", () => {
  const off = { detail: "feature disabled" };
  const tables = ["problems", "appeals", "submissions", "score_revisions", "attempts"];
  const snapshot = async () => Promise.all(tables.map(async (t) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<any>()).n));

  it("similarity, csv_export and bulk_import answer 404 and write nothing", async () => {
    const s = await seedGradedAttempt();
    const g = fakeGrader(() => jsonRes({ ok: true }));
    const call = client(g.binding, undefined, undefined, { DISABLED_FEATURES: "similarity,csv_export,bulk_import" });
    const before = await snapshot();
    const body = { problems: [{ title: "X", category: "Math", difficulty: "easy", statement: "s", func_name: "f", param_names: ["a"], reference_solution: "def f(a): return a", test_cases: [{ args: [1], expected: 1, is_public: true }] }] };
    for (const [m, p, b] of [
      ["GET", `/api/teacher/exams/${s.examId}/similarity`, undefined],
      ["GET", `/api/teacher/exams/${s.examId}/export.csv`, undefined],
      ["POST", "/api/teacher/problems/import", body],
    ] as const) {
      const r = await call(m, p, { as: s.teacher, body: b });
      expect([m, p, r.status, r.json]).toEqual([m, p, 404, off]);
    }
    expect(await snapshot()).toEqual(before);
    expect(g.calls).toEqual([]);
  });

  it("a disabled route does no more D1 work than the auth check alone", async () => {
    const s = await seedGradedAttempt();
    const mk = () => countingDb(env.DB);
    const a = mk();
    await client(s.grader.binding, undefined, a.db, { DISABLED_FEATURES: "csv_export" })("GET", "/api/teacher/me", { as: s.teacher });
    const b = mk();
    await client(s.grader.binding, undefined, b.db, { DISABLED_FEATURES: "csv_export" })("GET", `/api/teacher/exams/${s.examId}/export.csv`, { as: s.teacher });
    expect(b.count()).toBe(a.count());
  });

  it("the gated routes still work when the flag is empty or names another feature", async () => {
    const s = await seedGradedAttempt();
    const call = client(s.grader.binding, undefined, undefined, { DISABLED_FEATURES: "appeals" });
    expect((await call("GET", `/api/teacher/exams/${s.examId}/export.csv`, { as: s.teacher })).status).toBe(200);
    expect((await call("GET", `/api/teacher/exams/${s.examId}/similarity`, { as: s.teacher })).status).toBe(200);
  });

  it("appeals: every student and teacher route is 404, no row, no queue message", async () => {
    const s = await seedGradedAttempt();
    const filed = await s.call("POST", `/api/exam/${s.token}/attempts/by-receipt/${s.receipt}/appeals`, { body: { problem_id: s.problemId, message: "m", turnstile_token: "t" } });
    expect(filed.status).toBe(201);
    const appealId = (await env.DB.prepare("SELECT id FROM appeals LIMIT 1").first<any>()).id as string;

    const q = fakeQueue();
    const call = client(s.grader.binding, undefined, undefined, { DISABLED_FEATURES: "appeals", GRADING_QUEUE: q.binding });
    const before = await snapshot();
    const status = (await env.DB.prepare("SELECT status FROM appeals WHERE id = ?").bind(appealId).first<any>()).status;
    const stu = `/api/exam/${s.token}/attempts/by-receipt/${s.receipt}/appeals`;
    const calls: [string, string, unknown?][] = [
      ["GET", stu], ["POST", stu, { problem_id: s.problemId, message: "again", turnstile_token: "t" }],
      ["GET", `/api/teacher/exams/${s.examId}/appeals`], ["GET", `/api/teacher/appeals/${appealId}`],
      ["POST", `/api/teacher/appeals/${appealId}/review`, {}],
      ["POST", `/api/teacher/appeals/${appealId}/decision`, { decision: "rejected", note: "n" }],
    ];
    for (const [m, p, b] of calls) {
      const r = await call(m, p, { as: s.teacher, body: b });
      expect([m, p, r.status, r.json]).toEqual([m, p, 404, off]);
    }
    expect(await snapshot()).toEqual(before);
    expect((await env.DB.prepare("SELECT status FROM appeals WHERE id = ?").bind(appealId).first<any>()).status).toBe(status);
    expect(q.sent).toEqual([]);
  });

  it("the student exam endpoint says whether appeals are on", async () => {
    const s = await seedGradedAttempt();
    expect((await s.call("GET", `/api/exam/${s.token}`)).json.appeals_enabled).toBe(true);
    const off2 = client(s.grader.binding, undefined, undefined, { DISABLED_FEATURES: "appeals" });
    expect((await off2("GET", `/api/exam/${s.token}`)).json.appeals_enabled).toBe(false);
  });
});

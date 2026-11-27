import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAppeal, decideAppeal } from "../src/db/appeals";
import { getExamStats } from "../src/db/stats";
import { seedGradedAttempt } from "./appeals_fixture";

describe("exam stats", () => {
  it("summarizes one graded question", async () => {
    const f = await seedGradedAttempt();
    const res = await f.call("GET", `/api/teacher/exams/${f.examId}/stats`, { as: f.teacher });
    expect(res.status).toBe(200);
    const s = res.json;
    expect(s).toMatchObject({ attempts: 1, submitted: 1, grading: 0, failed: 0, mean_total: 60, needs_review: 0 });
    expect(s.histogram).toHaveLength(10);
    expect(s.histogram[6]).toBe(1);
    expect(s.questions).toHaveLength(1);
    expect(s.questions[0]).toMatchObject({ problem_id: f.problemId, pass_rate: 0, mean_score: 60 });
    expect(s.questions[0].criteria.correctness).toBeCloseTo(0.6);
    expect(s.appeals).toEqual({ filed: 0, decided: 0, adjusted: 0 });
  });

  it("uses the latest revision for the score", async () => {
    const f = await seedGradedAttempt();
    await env.DB.prepare(
      "INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, reason, created_at)" +
        " VALUES ('r1', ?, 1, 'teacher', 90, '{}', '{}', 't@x.com', 'why', '2026-11-27T00:00:00Z')",
    ).bind(f.submissionId).run();
    const s = await getExamStats(env.DB, f.examId);
    expect(s.mean_total).toBe(90);
    expect(s.histogram[9]).toBe(1);
  });

  it("returns zeros for an exam with no attempts", async () => {
    const other = await seedGradedAttempt();
    await env.DB.prepare("INSERT INTO exams (id, teacher_id, title, student_token, deadline, time_limit_seconds, created_at)" +
      " SELECT 'empty1', teacher_id, 'E', 'tok-empty', NULL, 600, created_at FROM exams WHERE id = ?").bind(other.examId).run();
    const s = await getExamStats(env.DB, "empty1");
    expect(s).toMatchObject({ attempts: 0, submitted: 0, mean_total: null, needs_review: 0 });
    expect(s.histogram).toEqual(Array(10).fill(0));
    expect(s.questions).toEqual([]);
  });

  it("counts a still-grading question apart and keeps it out of the mean", async () => {
    const f = await seedGradedAttempt({ graded: false });
    const s = await getExamStats(env.DB, f.examId);
    expect(s).toMatchObject({ attempts: 1, submitted: 1, grading: 1, mean_total: null });
    expect(s.questions[0].pass_rate).toBeNull();
  });

  it("hides another teacher's exam", async () => {
    const f = await seedGradedAttempt();
    const res = await f.call("GET", `/api/teacher/exams/${f.examId}/stats`, { as: "someone-else@x.com" });
    expect(res.status).toBe(404);
  });

  it("counts appeals of the exam", async () => {
    const f = await seedGradedAttempt();
    const id = await createAppeal(env.DB, { submissionId: f.submissionId, message: "m", now: new Date() });
    await decideAppeal(env.DB, { id, decision: "adjusted", note: "n", score: 80, teacherEmail: f.teacher, now: new Date() });
    const s = await getExamStats(env.DB, f.examId);
    expect(s.appeals).toEqual({ filed: 1, decided: 1, adjusted: 1 });
  });
});

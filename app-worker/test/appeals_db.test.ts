import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { AppealExists, createAppeal, decideAppeal, expireStaleAppeals, getAppealDetail, listAppealsForAttempt, markUnderReview } from "../src/db/appeals";
import { seedGradedAttempt } from "./appeals_fixture";

const DAY = 86_400_000;
const NOW = new Date("2026-12-01T00:00:00Z");
const revisions = async (submissionId: string) =>
  (await env.DB.prepare("SELECT revision, source, score, author, reason FROM score_revisions WHERE submission_id = ? ORDER BY revision").bind(submissionId).all<any>()).results;
const statusOf = async (id: string) => (await env.DB.prepare("SELECT status FROM appeals WHERE id = ?").bind(id).first<any>()).status;
const decide = (id: string, over: Partial<Parameters<typeof decideAppeal>[1]> = {}) =>
  decideAppeal(env.DB, { id, decision: "upheld", note: "n", teacherEmail: "t@x.com", now: NOW, ...over });

describe("createAppeal", () => {
  it("returns an id and refuses a second appeal for the same question", async () => {
    const s = await seedGradedAttempt();
    const id = await createAppeal(env.DB, { submissionId: s.submissionId, message: "m", now: NOW });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    await expect(createAppeal(env.DB, { submissionId: s.submissionId, message: "again", now: NOW })).rejects.toBeInstanceOf(AppealExists);
  });
});

describe("decideAppeal", () => {
  it("adjusted appends a teacher revision and closes the appeal", async () => {
    const s = await seedGradedAttempt();
    const id = await createAppeal(env.DB, { submissionId: s.submissionId, message: "m", now: NOW });
    expect(await decide(id, { decision: "adjusted", note: "regraded", score: 85, teacherEmail: "boss@x.com" })).toBe("ok");
    const revs = await revisions(s.submissionId);
    expect(revs).toHaveLength(2);
    expect(revs[1]).toEqual({ revision: 1, source: "teacher", score: 85, author: "boss@x.com", reason: "regraded" });
    const d = await getAppealDetail(env.DB, id);
    expect(d).toMatchObject({ status: "adjusted", decision_note: "regraded", decided_by: "boss@x.com", decided_at: NOW.toISOString() });
    expect(d!.revisions.map((r) => r.score)).toEqual([60, 85]);
  });

  it("upheld and rejected add no revision", async () => {
    const s = await seedGradedAttempt();
    const id = await createAppeal(env.DB, { submissionId: s.submissionId, message: "m", now: NOW });
    expect(await decide(id, { decision: "upheld" })).toBe("ok");
    expect(await revisions(s.submissionId)).toHaveLength(1);
    expect(await statusOf(id)).toBe("upheld");
  });

  it("a second decision is refused and changes nothing", async () => {
    const s = await seedGradedAttempt();
    const id = await createAppeal(env.DB, { submissionId: s.submissionId, message: "m", now: NOW });
    expect(await decide(id, { decision: "adjusted", score: 70 })).toBe("ok");
    expect(await decide(id, { decision: "adjusted", score: 99 })).toBe("already_decided");
    expect(await decide(id, { decision: "rejected" })).toBe("already_decided");
    expect(await revisions(s.submissionId)).toHaveLength(2);
    expect(await statusOf(id)).toBe("adjusted");
  });

  it("two concurrent decisions: exactly one wins and one revision is written", async () => {
    const s = await seedGradedAttempt();
    const id = await createAppeal(env.DB, { submissionId: s.submissionId, message: "m", now: NOW });
    const results = await Promise.all([
      decide(id, { decision: "adjusted", score: 70 }),
      decide(id, { decision: "adjusted", score: 80 }),
    ]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "already_decided")).toHaveLength(1);
    expect(await revisions(s.submissionId)).toHaveLength(2);
  });

  it("works from under_review", async () => {
    const s = await seedGradedAttempt();
    const id = await createAppeal(env.DB, { submissionId: s.submissionId, message: "m", now: NOW });
    expect(await markUnderReview(env.DB, id)).toBe(true);
    expect(await markUnderReview(env.DB, id)).toBe(false);
    expect(await statusOf(id)).toBe("under_review");
    expect(await decide(id, { decision: "rejected" })).toBe("ok");
  });
});

describe("listAppealsForAttempt", () => {
  it("returns the question, status and the latest score", async () => {
    const s = await seedGradedAttempt();
    const id = await createAppeal(env.DB, { submissionId: s.submissionId, message: "m", now: NOW });
    await decide(id, { decision: "adjusted", score: 85, note: "fixed" });
    expect(await listAppealsForAttempt(env.DB, s.attemptId)).toEqual([
      { problem_id: s.problemId, status: "adjusted", message: "m", decision_note: "fixed", created_at: NOW.toISOString(), decided_at: NOW.toISOString(), score: 85 },
    ]);
  });
});

describe("expireStaleAppeals", () => {
  it("expires only open appeals created before the cutoff", async () => {
    const cutoff = new Date(NOW.getTime() - 14 * DAY);
    const onBoundary = await seedGradedAttempt();
    const older = await seedGradedAttempt();
    const decided = await seedGradedAttempt();
    const a = await createAppeal(env.DB, { submissionId: onBoundary.submissionId, message: "m", now: cutoff });
    const b = await createAppeal(env.DB, { submissionId: older.submissionId, message: "m", now: new Date(cutoff.getTime() - 1000) });
    const c = await createAppeal(env.DB, { submissionId: decided.submissionId, message: "m", now: new Date(cutoff.getTime() - 5 * DAY) });
    await decide(c, { decision: "rejected" });
    expect(await expireStaleAppeals(env.DB, cutoff)).toBe(1);
    expect(await statusOf(a)).toBe("open");
    expect(await statusOf(b)).toBe("expired");
    expect(await statusOf(c)).toBe("rejected");
  });
});

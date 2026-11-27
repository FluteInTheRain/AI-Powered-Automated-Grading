import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { recordGrading } from "../src/metrics";
import { drain, fakeMetrics, jsonRes } from "./helpers";
import { seedGradedAttempt } from "./appeals_fixture";

const event = { outcome: "done", problemId: "p", model: "m", durationMs: 12, score: 60, deliveryAttempt: 1, passCount: 1, total: 2 } as const;

describe("recordGrading", () => {
  it("writes the documented shape", () => {
    const m = fakeMetrics();
    recordGrading(m.binding, event);
    expect(m.points).toEqual([{ indexes: ["p"], blobs: ["done", "p", "m"], doubles: [12, 60, 1, 1, 2] }]);
  });

  it("never throws, even when the dataset does", () => {
    const broken = { writeDataPoint: () => { throw new Error("down"); } } as unknown as AnalyticsEngineDataset;
    expect(() => recordGrading(broken, event)).not.toThrow();
  });

  it("leaves a trace in the log when a write is dropped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { writeDataPoint: () => { throw new Error("down"); } } as unknown as AnalyticsEngineDataset;
    recordGrading(broken, event);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("metrics"), expect.anything());
    warn.mockRestore();
  });

  it("does nothing when the binding is absent", () => {
    expect(() => recordGrading(undefined, event)).not.toThrow();
  });
});

describe("events from the queue consumer", () => {
  it("writes one done point for a graded submission", async () => {
    const f = await seedGradedAttempt({ graded: false });
    const m = fakeMetrics();
    await drain(f.queue, f.grader.binding, 1, { METRICS: m.binding });
    expect(m.points).toHaveLength(1);
    const p = m.points[0];
    expect(p.blobs).toEqual(["done", f.problemId, "m"]);
    expect(p.doubles![0]).toBeGreaterThanOrEqual(0);
    expect(p.doubles!.slice(1)).toEqual([60, 1, 1, 2]);
  });

  it("writes a blank point, with no grader call, for the unchanged starter code", async () => {
    const f = await seedGradedAttempt({ graded: false, code: "def f(x): pass" });
    const m = fakeMetrics();
    await drain(f.queue, f.grader.binding, 1, { METRICS: m.binding });
    expect(f.grader.calls).toHaveLength(0);
    expect(m.points.map((p) => p.blobs![0])).toEqual(["blank"]);
  });

  it("writes retry while deliveries remain and failed on the last one", async () => {
    const f = await seedGradedAttempt({ graded: false });
    const down = { fetch: async () => jsonRes({ detail: "x" }, 502) } as unknown as Fetcher;
    const m = fakeMetrics();
    await drain(f.queue, down, 1, { METRICS: m.binding });
    f.queue.sent.push({ submission_id: f.submissionId });
    await drain(f.queue, down, 3, { METRICS: m.binding });
    expect(m.points.map((p) => p.blobs![0])).toEqual(["retry", "failed"]);
    expect(m.points.map((p) => p.doubles![2])).toEqual([1, 3]);
  });

  it("a malformed grader result cannot make a stored grade retry or fail", async () => {
    const f = await seedGradedAttempt({ graded: false });
    const odd = { fetch: async () => jsonRes({ result: { final_score_0_to_100: 50, sub_scores_0_to_1: { correctness: 0.5 }, check_details: null, feedback: null }, call_log: [] }) } as unknown as Fetcher;
    const m = fakeMetrics();
    await drain(f.queue, odd, 1, { METRICS: m.binding });
    const job = await env.DB.prepare("SELECT status FROM grading_jobs WHERE submission_id = ?").bind(f.submissionId).first<any>();
    expect(job.status).toBe("done");
    expect(f.queue.sent).toHaveLength(0);
  });
});

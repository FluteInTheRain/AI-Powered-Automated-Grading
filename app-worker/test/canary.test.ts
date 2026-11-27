import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { canaryHistory } from "../src/db/canary";
import { runCanary } from "../src/canary";
import type { Env } from "../src/env";
import worker from "../src/index";
import { fakeGrader, jsonRes } from "./helpers";
import { createAppeal } from "../src/db/appeals";
import { seedGradedAttempt } from "./appeals_fixture";

const result = (score = 80) => ({
  result: {
    final_score_0_to_100: score, sub_scores_0_to_1: { correctness: 1, efficiency: 0.5 },
    execution_result: { pass_count: 2, total: 2, status: "ran", errors: [] }, check_details: null, feedback: null,
  },
});
const okGrader = (raw = "r", model = "m", score = 80) =>
  fakeGrader(async () => jsonRes({ ...result(score), call_log: [{ kind: "check", model, system_prompt: "s", user_prompt: "u", raw_response: raw }] }));
const run = (g: { binding: Fetcher }, at = new Date()) =>
  runCanary({ DB: env.DB, GRADER: g.binding, INTERNAL_TOKEN: "tok" }, at);
const verdicts = async () => (await canaryHistory(env.DB, 50)).map((r) => r.verdict).reverse();

beforeEach(async () => { await env.DB.prepare("DELETE FROM canary_runs").run(); });

describe("canary", () => {
  it("the first run is the baseline and an identical second run is stable", async () => {
    await run(okGrader());
    await run(okGrader());
    expect(await verdicts()).toEqual(["baseline", "stable"]);
  });

  it("a different raw response or score is a mismatch", async () => {
    await run(okGrader("a"));
    await run(okGrader("b"));
    await run(okGrader("a", "m", 70));
    expect(await verdicts()).toEqual(["baseline", "mismatch", "mismatch"]);
  });

  it("a different model starts its own baseline instead of a mismatch", async () => {
    await run(okGrader("a", "m1"));
    await run(okGrader("a", "m2"));
    expect(await verdicts()).toEqual(["baseline", "baseline"]);
  });

  it("a new input_version starts its own baseline", async () => {
    await run(okGrader());
    await env.DB.prepare("UPDATE canary_runs SET input_version = 0").run();
    await run(okGrader("zzz"));
    expect(await verdicts()).toEqual(["baseline", "baseline"]);
  });

  it("a grader error stores an error row and does not throw", async () => {
    await run(fakeGrader(async () => jsonRes({ detail: "down" }, 502)));
    const rows = await canaryHistory(env.DB, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "error", verdict: "error", score: null });
  });

  it("an error row does not break the comparison of the next run", async () => {
    await run(okGrader());
    await run(fakeGrader(async () => jsonRes({ detail: "down" }, 502)));
    await run(okGrader());
    expect(await verdicts()).toEqual(["baseline", "error", "stable"]);
  });

  it("the daily cron still expires appeals when the canary's grader is down", async () => {
    const f = await seedGradedAttempt();
    const id = await createAppeal(env.DB, { submissionId: f.submissionId, message: "m", now: new Date(Date.now() - 15 * 86_400_000) });
    const down = fakeGrader(async () => jsonRes({ detail: "down" }, 502));
    await worker.scheduled({} as ScheduledController, { ...env, GRADER: down.binding } as unknown as Env);
    expect((await env.DB.prepare("SELECT status FROM appeals WHERE id = ?").bind(id).first<any>()).status).toBe("expired");
    expect((await canaryHistory(env.DB, 5))[0].status).toBe("error");
  });

  it("the daily cron records a canary run", async () => {
    await worker.scheduled({} as ScheduledController, { ...env, GRADER: okGrader().binding } as unknown as Env);
    expect(await verdicts()).toEqual(["baseline"]);
  });
});

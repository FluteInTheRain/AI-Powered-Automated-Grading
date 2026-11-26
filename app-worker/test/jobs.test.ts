import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createAttempt } from "../src/db/attempts";
import { getJob, insertSubmissionWithJob } from "../src/db/jobs";
import type { Env } from "../src/env";
import { MAX_DELIVERIES, processJob, queue } from "../src/jobs";
import { fakeGrader, jsonRes } from "./helpers";

const NOW = "2026-11-26T00:00:00Z";
const KILLED = "Grading failed: your submission exceeded the time/resource limit.";
const FIXED = "Grading service error, please try again.";
const OK = {
  result: {
    final_score_0_to_100: 80, sub_scores_0_to_1: { correctness: 1 },
    execution_result: { pass_count: 1, total: 1, status: "ran", errors: ["input=[2] expected=HIDDEN got=3"] },
    check_details: null, feedback: { summary: "ok", issues: [] },
  },
  call_log: [{ kind: "check", schema: "S", model: "m", system_prompt: "sp", user_prompt: "up", raw_response: "rr" }],
};

let mode: "ok" | "killed" | "5xx" = "ok";
const grader = fakeGrader(async () => {
  if (mode === "killed") return jsonRes({ detail: KILLED }, 502);
  if (mode === "5xx") return jsonRes({ detail: "stack trace" }, 500);
  return jsonRes(OK);
});
const mkEnv = (db: D1Database = env.DB) => ({ DB: db, GRADER: grader.binding, INTERNAL_TOKEN: "t", AUDIT: env.AUDIT }) as unknown as Env;

beforeAll(async () => {
  await env.DB.prepare("INSERT INTO teachers (id, email, created_at) VALUES ('kt','kt@x.com',?)").bind(NOW).run();
  await env.DB.prepare(
    "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric, reference_solution, test_cases, starter_code, created_at)" +
      " VALUES ('kp', NULL, 'system', 'stmt','fn','[]','{\"correctness\":100}','r','[{\"args\":[2],\"expected\":\"HIDDEN\",\"is_public\":false}]','c',?)").bind(NOW).run();
  await env.DB.prepare("INSERT INTO exams (id, teacher_id, title, student_token, deadline, time_limit_seconds, created_at) VALUES ('ke','kt','T','tok-ke',NULL,600,?)").bind(NOW).run();
});

let n = 0;
async function newSubmission() {
  const a = await createAttempt(env.DB, "ke", `Student ${n++}`, new Date());
  return insertSubmissionWithJob(env.DB, { attemptId: a.attempt_id, problemId: "kp", code: "def fn(x): return 3" });
}
const revisions = async (sid: string) =>
  (await env.DB.prepare("SELECT count(*) AS c FROM score_revisions WHERE submission_id = ?").bind(sid).first<{ c: number }>())!.c;
const auditObjects = async (sid: string) => (await env.AUDIT.list({ prefix: `audit/${sid}` })).objects.length;

describe("processJob", () => {
  it("success writes revision 0, one audit object holding the call log, and marks the job done", async () => {
    mode = "ok";
    const sid = await newSubmission();
    expect(await processJob(mkEnv(), sid, 1)).toBe("done");
    const rev = await env.DB.prepare("SELECT revision, source, score, author FROM score_revisions WHERE submission_id = ?").bind(sid).first<any>();
    expect(rev).toEqual({ revision: 0, source: "ai", score: 80, author: "pipeline" });
    const job = await getJob(env.DB, sid);
    expect(job).toMatchObject({ status: "done", audit_key: `audit/${sid}.json`, attempts: 1 });
    const blob = await (await env.AUDIT.get(`audit/${sid}.json`))!.json<any>();
    expect(blob.call_log).toEqual(OK.call_log);
    expect(blob.submission_id).toBe(sid);
  });

  it("only the hidden cases are sent to the grader", async () => {
    mode = "ok";
    const sid = await newSubmission();
    await processJob(mkEnv(), sid, 1);
    expect(grader.calls.at(-1)!.body.hidden_cases).toEqual([{ args: [2], expected: "HIDDEN", is_public: false }]);
  });

  it("a redelivered message after done does nothing: no second revision, no second audit object, no grading", async () => {
    mode = "ok";
    const sid = await newSubmission();
    await processJob(mkEnv(), sid, 1);
    const calls = grader.calls.length;
    expect(await processJob(mkEnv(), sid, 2)).toBe("done");
    expect(grader.calls.length).toBe(calls);
    expect(await revisions(sid)).toBe(1);
    expect(await auditObjects(sid)).toBe(1);
  });

  it("R2 write ok but the D1 write fails: the retry ends with exactly one revision and one audit object", async () => {
    mode = "ok";
    const sid = await newSubmission();
    let failed = false;
    const flaky = new Proxy(env.DB, {
      get(t, k) {
        if (k === "batch") return async (s: D1PreparedStatement[]) => { if (!failed) { failed = true; throw new Error("D1 down"); } return t.batch(s); };
        const v = (t as any)[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as D1Database;
    expect(await processJob(mkEnv(flaky), sid, 1)).toBe("retry");
    expect(await auditObjects(sid)).toBe(1);
    expect(await revisions(sid)).toBe(0);
    expect(await processJob(mkEnv(flaky), sid, 2)).toBe("done");
    expect(await revisions(sid)).toBe(1);
    expect(await auditObjects(sid)).toBe(1);
  });

  it("a sandbox kill fails permanently on the first delivery with one grader call", async () => {
    mode = "killed";
    const sid = await newSubmission();
    const calls = grader.calls.length;
    expect(await processJob(mkEnv(), sid, 1)).toBe("failed");
    expect(grader.calls.length).toBe(calls + 1);
    expect(await getJob(env.DB, sid)).toMatchObject({ status: "failed", error: KILLED });
    expect(await revisions(sid)).toBe(0);
    mode = "ok";
  });

  it("a grader 5xx retries until the third delivery, then fails with the fixed text", async () => {
    mode = "5xx";
    const sid = await newSubmission();
    expect(await processJob(mkEnv(), sid, 1)).toBe("retry");
    expect(await getJob(env.DB, sid)).toMatchObject({ status: "queued" });
    expect(await processJob(mkEnv(), sid, 2)).toBe("retry");
    expect(await processJob(mkEnv(), sid, MAX_DELIVERIES)).toBe("failed");
    expect(await getJob(env.DB, sid)).toMatchObject({ status: "failed", error: FIXED });
    mode = "ok";
  });

  it("an unknown submission id is dropped as failed without throwing", async () => {
    expect(await processJob(mkEnv(), "does-not-exist", 1)).toBe("failed");
  });
});

describe("queue consumer", () => {
  const msg = (submission_id: string, attempts: number) => {
    const calls: { ack: number; retry: unknown[] } = { ack: 0, retry: [] };
    return { m: { id: "m", body: { submission_id }, attempts, ack: () => { calls.ack++; }, retry: (o?: unknown) => { calls.retry.push(o); } }, calls };
  };
  const batch = (...ms: ReturnType<typeof msg>[]) => ({ queue: "grading-jobs", messages: ms.map((x) => x.m) }) as unknown as MessageBatch<{ submission_id: string }>;

  it("acks done and failed jobs and retries a transient failure with a growing delay", async () => {
    mode = "ok";
    const done = msg(await newSubmission(), 1);
    await queue(batch(done), mkEnv());
    expect(done.calls.ack).toBe(1);

    mode = "killed";
    const dead = msg(await newSubmission(), 1);
    await queue(batch(dead), mkEnv());
    expect(dead.calls.ack).toBe(1);

    mode = "5xx";
    const flaky = msg(await newSubmission(), 2);
    await queue(batch(flaky), mkEnv());
    expect(flaky.calls.ack).toBe(0);
    expect(flaky.calls.retry).toEqual([{ delaySeconds: 60 }]);
    mode = "ok";
  });
});

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { client, countingDb, drain, fakeGrader, fakeQueue, jsonRes } from "./helpers";

// Pins the per-request costs that docs/load-test.md builds its capacity model on, for an exam of 5 questions.
// D1 prepare() calls are counted per statement. Cloudflare counts one db.batch() as one query, so these are upper bounds
// for the Free plan limit of 50 queries per invocation.
const QUESTIONS = 5;
const RUBRIC = JSON.stringify({ correctness: 100 });
const CASES = JSON.stringify([{ args: [1], expected: 1, is_public: true }, { args: [2], expected: 2, is_public: false }]);

const grader = fakeGrader(async () =>
  jsonRes({
    result: {
      final_score_0_to_100: 80, sub_scores_0_to_1: { correctness: 1 },
      execution_result: { pass_count: 1, total: 1, status: "ran", errors: [] }, check_details: null, feedback: null,
    },
    call_log: [{ kind: "check", model: "m", system_prompt: "s", user_prompt: "u", raw_response: "r" }],
  }));
const q = fakeQueue();
const ids = Array.from({ length: QUESTIONS }, (_, i) => `bank:cap${i}`);

describe("per-request costs of a 5-question exam", () => {
  it("stays under the Free plan's 50 queries per invocation on every route", async () => {
    for (const id of ids) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric," +
          " reference_solution, test_cases, starter_code, created_at) VALUES (?, NULL, 'system', 'st', 'f','[\"x\"]',?,'ref',?,'def f(x): pass','2026-01-01T00:00:00Z')",
      ).bind(id, RUBRIC, CASES).run();
    }
    const plain = client(grader.binding, undefined, undefined, { GRADING_QUEUE: q.binding });
    const made = await plain("POST", "/api/teacher/exams", { as: "cap@x.com", body: { title: "T", questions: ids.map((p) => ({ problem_id: p, weight: 1 })) } });
    const token = made.json.student_token as string;

    const measure = async (run: (c: ReturnType<typeof client>) => Promise<{ status: number; json: any }>) => {
      const counted = countingDb(env.DB);
      const res = await run(client(grader.binding, undefined, counted.db, { GRADING_QUEUE: q.binding }));
      return { res, queries: counted.count() };
    };

    const started = await measure((c) => c("POST", `/api/exam/${token}/attempts`, { body: { student_name: "Cap" } }));
    expect(started.res.status).toBe(200);
    const attempt = started.res.json.attempt_id as string;
    const answers = Object.fromEntries(ids.map((p) => [p, "def f(x): return x"]));
    const submitted = await measure((c) => c("POST", `/api/exam/${token}/attempts/${attempt}/submit`, { body: { answers } }));
    expect(submitted.res.status).toBe(202);
    expect(q.sent).toHaveLength(QUESTIONS); // one queue message per question
    const polled = await measure((c) => c("GET", `/api/exam/${token}/attempts/${attempt}/questions/${ids[0]}/status`));

    const counted = countingDb(env.DB);
    const jobs = q.sent.length;
    await drain(q, grader.binding, 1, { DB: counted.db });
    const perMessage = counted.count() / jobs;

    console.log(`[capacity] D1 statements: start=${started.queries} submit=${submitted.queries} status=${polled.queries} grade=${perMessage}/message`);
    for (const n of [started.queries, submitted.queries, polled.queries, perMessage]) expect(n).toBeLessThan(50);
  });
});

// Stand-in for the Python grading Worker in local load tests (scripts/load_test.mjs). It is bound to the app as the
// service named "grading" and answers /api/internal/{grade,run,preview,validate-problem} after a configurable delay.
// It calls no model and no sandbox, so it says nothing about real grading time or Workers AI limits.
//
// Vars (set by load_test.mjs in a generated wrangler config):
//   FAKE_LATENCY_MS  base delay of /grade, default 3000
//   FAKE_JITTER_MS   plus a uniform 0..jitter, default 0
//   FAKE_FAIL_RATE   share of /grade calls answered with HTTP 502 (a transient error, so the queue retries), default 0
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const body = await request.json().catch(() => ({}));
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (path === "/api/syntax-check") return json({ ok: true });
    if (path.endsWith("/run")) {
      return json({ status: "ran", message: null, cases: (body.cases ?? []).map(() => ({ passed: true, error: null })) });
    }
    if (!path.endsWith("/grade")) return json({});
    const delay = Number(env.FAKE_LATENCY_MS ?? 3000) + Math.random() * Number(env.FAKE_JITTER_MS ?? 0);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (Math.random() < Number(env.FAKE_FAIL_RATE ?? 0)) return json({ detail: "fake transient failure" }, 502);
    const subs = Object.fromEntries(Object.keys(body.rubric ?? { correctness: 100 }).map((k) => [k, 1]));
    return json({
      result: {
        final_score_0_to_100: 80, sub_scores_0_to_1: subs,
        execution_result: { pass_count: 2, total: 2, status: "ran", errors: [] }, check_details: null, feedback: { summary: "fake" },
      },
      call_log: Array.from({ length: 4 }, (_, i) => ({
        kind: i < 3 ? "check" : "feedback", model: "fake", system_prompt: "fake", user_prompt: "fake", raw_response: "{}",
      })),
    });
  },
};

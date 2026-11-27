import type { Env } from "./env";

export type HealthRow = { day: string; outcome: string; count: number; p50_ms: number; p95_ms: number };

// Fixed query: no user input ever reaches Analytics Engine. Counts and quantiles are weighted by _sample_interval.
const HEALTH_SQL =
  "SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob1 AS outcome, SUM(_sample_interval) AS count," +
  " quantileExactWeighted(0.5)(double1, _sample_interval) AS p50_ms, quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_ms" +
  " FROM grading_events WHERE timestamp > now() - INTERVAL '14' DAY GROUP BY day, outcome ORDER BY day DESC, outcome";

/** Grading health of the last 14 days from the Analytics Engine SQL API, or null when it is not configured or fails. */
export async function queryHealth(
  env: Partial<Pick<Env, "CF_ACCOUNT_ID" | "CF_API_TOKEN">>,
  fetchFn: typeof fetch = fetch,
): Promise<HealthRow[] | null> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    console.warn("analytics: CF_ACCOUNT_ID or CF_API_TOKEN is not set; grading health is unavailable");
    return null;
  }
  try {
    const res = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
      method: "POST", headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` }, body: HEALTH_SQL,
    });
    if (res.status !== 200) {
      console.warn(`analytics: SQL API answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const body = (await res.json()) as { data?: Record<string, unknown>[] };
    if (!Array.isArray(body.data)) return null;
    return body.data.map((r) => ({
      day: String(r.day).slice(0, 10), outcome: String(r.outcome),
      count: Number(r.count), p50_ms: Number(r.p50_ms), p95_ms: Number(r.p95_ms),
    }));
  } catch (err) {
    console.warn("analytics: SQL API call failed", err);
    return null;
  }
}

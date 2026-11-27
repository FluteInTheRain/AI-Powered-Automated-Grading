import { newId } from "../ids";

export type CanaryRow = {
  id: string; ran_at: string; score: number | null; sub_scores: string | null; fingerprint: string | null;
  model: string | null; input_version: number; status: "ok" | "error"; error: string | null;
};
export type Verdict = "baseline" | "stable" | "mismatch" | "error";

export async function insertCanaryRun(
  db: D1Database,
  r: { ranAt: Date; inputVersion: number; status: "ok" | "error"; score?: number; subScores?: string; fingerprint?: string; model?: string; error?: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO canary_runs (id, ran_at, score, sub_scores, fingerprint, model, input_version, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newId(), r.ranAt.toISOString(), r.score ?? null, r.subScores ?? null, r.fingerprint ?? null, r.model ?? null, r.inputVersion, r.status, r.error ?? null)
    .run();
}

/**
 * The newest `limit` runs, newest first, each with its verdict. The baseline of a run is the earliest ok run with the
 * same (model, input_version), so a deliberate change of either starts a fresh baseline instead of a permanent mismatch.
 */
export async function canaryHistory(db: D1Database, limit: number) {
  const { results } = await db.prepare("SELECT * FROM canary_runs ORDER BY ran_at, rowid").all<CanaryRow>();
  const baselines = new Map<string, CanaryRow>();
  const out = results.map((r) => {
    let verdict: Verdict = "error";
    if (r.status === "ok") {
      const key = `${r.model}|${r.input_version}`;
      const base = baselines.get(key);
      if (!base) { baselines.set(key, r); verdict = "baseline"; }
      else verdict = base.score === r.score && base.sub_scores === r.sub_scores && base.fingerprint === r.fingerprint ? "stable" : "mismatch";
    }
    return { ran_at: r.ran_at, score: r.score, status: r.status, verdict, error: r.error };
  });
  return out.reverse().slice(0, limit);
}

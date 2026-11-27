export type OverturnStats = { filed: number; decided: number; adjusted: number; mean_delta: number | null };

/**
 * Whole-platform appeal numbers. A single teacher decides, and only disputed submissions appear here, so this is a
 * selection-biased signal, never an accuracy or "agreement with human graders" figure.
 */
export async function overturnStats(db: D1Database): Promise<OverturnStats> {
  const r = await db
    .prepare(
      "SELECT count(*) AS filed, coalesce(sum(status IN ('upheld','rejected','adjusted')), 0) AS decided," +
        " coalesce(sum(status = 'adjusted'), 0) AS adjusted," +
        " (SELECT avg(l.score - z.score) FROM appeals p JOIN score_revisions l ON l.submission_id = p.submission_id" +
        "   AND l.revision = (SELECT max(revision) FROM score_revisions WHERE submission_id = p.submission_id)" +
        "  JOIN score_revisions z ON z.submission_id = p.submission_id AND z.revision = 0" +
        "  WHERE p.status = 'adjusted') AS mean_delta FROM appeals",
    ).first<OverturnStats>();
  return { filed: r?.filed ?? 0, decided: r?.decided ?? 0, adjusted: r?.adjusted ?? 0, mean_delta: r?.mean_delta ?? null };
}

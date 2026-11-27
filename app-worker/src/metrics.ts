export type GradingEvent = {
  outcome: "done" | "blank" | "retry" | "failed";
  problemId: string;
  model: string;
  durationMs: number;
  score: number;
  deliveryAttempt: number;
  passCount: number;
  total: number;
};

/**
 * One Analytics Engine point per grading attempt. Best effort by design: a metrics fault must never fail, retry or slow
 * a grade, so every error is dropped here.
 */
export function recordGrading(metrics: AnalyticsEngineDataset | undefined, e: GradingEvent): void {
  try {
    metrics?.writeDataPoint({
      indexes: [e.problemId],
      blobs: [e.outcome, e.problemId, e.model],
      doubles: [e.durationMs, e.score, e.deliveryAttempt, e.passCount, e.total],
    });
  } catch {
    /* dropped on purpose */
  }
}

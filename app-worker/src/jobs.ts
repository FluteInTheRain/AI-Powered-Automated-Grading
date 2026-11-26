import type { Env } from "./env";
import { GraderError, gradeQuestion, type GradeOutput, type LogEntry } from "./grader";
import { getJob, getSubmissionBundle, setJobStatus } from "./db/jobs";
import type { Problem } from "./db/problems";

export const MAX_DELIVERIES = 3;
const FIXED_ERROR = "Grading service error, please try again.";

type Outcome = "done" | "retry" | "failed";
type GradeResult = GradeOutput["result"];

/** A stored failure message that retrying cannot fix: the student's own code killed the sandbox. */
export const isPermanentError = (error: string | null) => !!error && error.includes("time/resource");

/** The student's own code killed the sandbox (or the request was malformed): retrying cannot help. */
const isPermanent = (e: GraderError) => e.status === 400 || isPermanentError(e.detail);

/**
 * The result of a question with no verified behaviour: zero on every dimension, as the grader scores code that never
 * runs or passes nothing. Used for a blank answer and for code that kills the sandbox.
 */
function zeroResult(problem: Problem, status: string): GradeResult {
  return {
    final_score_0_to_100: 0,
    sub_scores_0_to_1: Object.fromEntries(Object.keys(problem.rubric).map((k) => [k, 0])),
    execution_result: { pass_count: 0, total: problem.test_cases.filter((t) => !t.is_public).length, status, errors: [] },
    check_details: null,
    feedback: null,
  };
}

/**
 * Stores a finished question: the call log in R2 (fixed key, so a rerun overwrites it), then revision 0 and the job state
 * in one D1 batch (revision 0 is only inserted when it does not exist yet, so a redelivery cannot add a second one).
 */
async function settle(
  env: Env, submissionId: string, result: GradeResult, callLog: LogEntry[], job: { status: "done" | "failed"; error?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const key = `audit/${submissionId}.json`;
  await env.AUDIT.put(key, JSON.stringify({ submission_id: submissionId, graded_at: now, call_log: callLog }), {
    httpMetadata: { contentType: "application/json" },
  });
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, reason, created_at)" +
        " SELECT ?, ?, 0, 'ai', ?, ?, ?, 'pipeline', NULL, ? WHERE NOT EXISTS" +
        " (SELECT 1 FROM score_revisions WHERE submission_id = ? AND revision = 0)",
    ).bind(crypto.randomUUID().replaceAll("-", ""), submissionId, result.final_score_0_to_100,
      JSON.stringify(result.sub_scores_0_to_1), JSON.stringify(result), now, submissionId),
    env.DB.prepare("UPDATE grading_jobs SET status = ?, audit_key = ?, error = ?, updated_at = ? WHERE submission_id = ?")
      .bind(job.status, key, job.error ?? null, now, submissionId),
  ]);
}

/**
 * Grades one stored submission. Safe to run more than once for the same id (queues deliver at least once): a finished job
 * returns early. A blank answer (the unchanged starter code) is scored zero here, without a sandbox run or an LLM call.
 */
export async function processJob(env: Env, submissionId: string, deliveryAttempt: number): Promise<Outcome> {
  const job = await getJob(env.DB, submissionId);
  if (!job) return "failed"; // nothing to grade; drop the message
  if (job.status === "done") return "done";
  const bundle = await getSubmissionBundle(env.DB, submissionId);
  if (!bundle) return "failed";
  const { submission, problem } = bundle;

  await setJobStatus(env.DB, submissionId, "grading", { bumpAttempts: true });
  try {
    if (submission.code.trim() === problem.starter_code.trim()) {
      await settle(env, submissionId, zeroResult(problem, "ran"), [], { status: "done" });
      return "done";
    }
    const out = await gradeQuestion(env, {
      statement: problem.statement, func_name: problem.func_name, rubric: problem.rubric,
      hidden_cases: problem.test_cases.filter((t) => !t.is_public), code: submission.code,
    });
    await settle(env, submissionId, out.result, out.call_log, { status: "done" });
    return "done";
  } catch (e) {
    if (e instanceof GraderError && isPermanent(e)) {
      try {
        // No verified behaviour: score zero (so the exam still gets a total) and keep the failure visible.
        await settle(env, submissionId, zeroResult(problem, "failed"), [], { status: "failed", error: e.detail });
        return "failed";
      } catch {
        /* storing the zero failed: handle it like a transient error below */
      }
    }
    if (deliveryAttempt >= MAX_DELIVERIES) {
      await setJobStatus(env.DB, submissionId, "failed", { error: FIXED_ERROR });
      return "failed";
    }
    await setJobStatus(env.DB, submissionId, "queued");
    return "retry";
  }
}

/** Queue consumer: one message per submission id. */
export async function queue(batch: MessageBatch<{ submission_id: string }>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const outcome = await processJob(env, msg.body.submission_id, msg.attempts);
    if (outcome === "retry") msg.retry({ delaySeconds: 30 * msg.attempts });
    else msg.ack();
  }
}

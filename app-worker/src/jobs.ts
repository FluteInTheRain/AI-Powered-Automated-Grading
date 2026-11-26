import type { Env } from "./env";
import { GraderError, gradeQuestion } from "./grader";
import { getJob, getSubmissionBundle, setJobStatus } from "./db/jobs";

export const MAX_DELIVERIES = 3;
const FIXED_ERROR = "Grading service error, please try again.";

type Outcome = "done" | "retry" | "failed";

/** A stored failure message that retrying cannot fix: the student's own code killed the sandbox. */
export const isPermanentError = (error: string | null) => !!error && error.includes("time/resource");

/** The student's own code killed the sandbox (or the request was malformed): retrying cannot help. */
const isPermanent = (e: GraderError) => e.status === 400 || isPermanentError(e.detail);

/**
 * Grades one stored submission. Safe to run more than once for the same id (queues deliver at
 * least once): a finished job returns early, the audit key is fixed so a rerun overwrites it, and
 * revision 0 is only inserted when it does not exist yet.
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
    const out = await gradeQuestion(env, {
      statement: problem.statement, func_name: problem.func_name, rubric: problem.rubric,
      hidden_cases: problem.test_cases.filter((t) => !t.is_public), code: submission.code,
    });
    const now = new Date().toISOString();
    const key = `audit/${submissionId}.json`;
    await env.AUDIT.put(key, JSON.stringify({ submission_id: submissionId, graded_at: now, call_log: out.call_log }), {
      httpMetadata: { contentType: "application/json" },
    });
    const r = out.result;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, reason, created_at)" +
          " SELECT ?, ?, 0, 'ai', ?, ?, ?, 'pipeline', NULL, ? WHERE NOT EXISTS" +
          " (SELECT 1 FROM score_revisions WHERE submission_id = ? AND revision = 0)",
      ).bind(crypto.randomUUID().replaceAll("-", ""), submissionId, r.final_score_0_to_100,
        JSON.stringify(r.sub_scores_0_to_1), JSON.stringify(r), now, submissionId),
      env.DB.prepare("UPDATE grading_jobs SET status = 'done', audit_key = ?, error = NULL, updated_at = ? WHERE submission_id = ?")
        .bind(key, now, submissionId),
    ]);
    return "done";
  } catch (e) {
    if (e instanceof GraderError && isPermanent(e)) {
      await setJobStatus(env.DB, submissionId, "failed", { error: e.detail });
      return "failed";
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

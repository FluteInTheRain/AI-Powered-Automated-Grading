import { env } from "cloudflare:workers";
import { client, drain, fakeGrader, fakeQueue, jsonRes } from "./helpers";

let n = 0;

/**
 * A one-question exam with one submitted attempt. With `graded` (the default) the queue is drained, so revision 0
 * and the R2 audit object exist; without it the job stays queued and the question has no score yet.
 */
export async function seedGradedAttempt(opts: { teacher?: string; name?: string; graded?: boolean } = {}) {
  const problemId = `bank:ap${++n}`;
  await env.DB.prepare(
    "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric," +
      " reference_solution, test_cases, starter_code, created_at) VALUES (?, NULL, 'system', 'ST', 'f','[\"x\"]',?,'REF','[]','def f(x): pass','2026-01-01T00:00:00Z')",
  ).bind(problemId, JSON.stringify({ correctness: 100 })).run();

  const q = fakeQueue();
  const grader = fakeGrader(async () => jsonRes({
    result: {
      final_score_0_to_100: 60, sub_scores_0_to_1: { correctness: 0.6 },
      execution_result: { pass_count: 1, total: 2, status: "ran", errors: [] },
      check_details: null, feedback: { summary: "ok", issues: [] },
    },
    call_log: [{ kind: "check", schema: "S", model: "m", system_prompt: "sp", user_prompt: "up", raw_response: "rr" }],
  }));
  const call = client(grader.binding, undefined, undefined, { GRADING_QUEUE: q.binding });

  const teacher = opts.teacher ?? `teacher${n}@x.com`;
  const exam = await call("POST", "/api/teacher/exams", { as: teacher, body: { title: "T", questions: [{ problem_id: problemId }] } });
  const token = exam.json.student_token as string;
  const att = await call("POST", `/api/exam/${token}/attempts`, { body: { student_name: opts.name ?? "Stu" } });
  const attemptId = att.json.attempt_id as string;
  await call("POST", `/api/exam/${token}/attempts/${attemptId}/submit`, { body: { answers: { [problemId]: "def f(x): return 3" } } });
  if (opts.graded ?? true) await drain(q, grader.binding);

  const sub = await env.DB.prepare("SELECT id FROM submissions WHERE attempt_id = ?").bind(attemptId).first<{ id: string }>();
  return {
    call, queue: q, grader, examId: exam.json.id as string, token, teacher,
    attemptId, receipt: att.json.receipt_code as string, problemId, submissionId: sub!.id,
  };
}

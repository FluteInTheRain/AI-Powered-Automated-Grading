import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";

const run = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run();
const NOW = "2026-11-25T00:00:00Z";

// D1 state is shared inside one test file: seed once; every test only probes rejections.
beforeAll(async () => {
  await run("INSERT INTO teachers (id, email, created_at) VALUES ('t1','a@x.com',?)", NOW);
  await run(
    "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric," +
      " reference_solution, test_cases, starter_code, created_at) VALUES ('p1', NULL, 'system', 's','f','[]','{}','r','[]','c',?)",
    NOW,
  );
  await run(
    "INSERT INTO exams (id, teacher_id, title, student_token, deadline, time_limit_seconds, created_at)" +
      " VALUES ('e1','t1','T','tok',NULL,600,?)",
    NOW,
  );
  await run("INSERT INTO attempts (id, exam_id, student_name, receipt_code, started_at) VALUES ('a1','e1','S','CODE',?)", NOW);
  await run("INSERT INTO submissions (id, attempt_id, problem_id, code, submitted_at) VALUES ('s1','a1','p1','x',?)", NOW);
  await run(
    "INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, reason, created_at)" +
      " VALUES ('r1','s1',0,'ai',50,'{}','{}','pipeline',NULL,?)",
    NOW,
  );
});

it("score revision update is rejected", async () => {
  await expect(run("UPDATE score_revisions SET score = 99 WHERE id = 'r1'")).rejects.toThrow(/append-only/);
});

it("score revision delete is rejected", async () => {
  await expect(run("DELETE FROM score_revisions WHERE id = 'r1'")).rejects.toThrow(/append-only/);
});

it("submission update is rejected", async () => {
  await expect(run("UPDATE submissions SET code = 'y' WHERE id = 's1'")).rejects.toThrow(/append-only/);
});

it("duplicate revision number is rejected", async () => {
  await expect(
    run(
      "INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, created_at)" +
        " VALUES ('r2','s1',0,'teacher',60,'{}','{}','t',?)",
      NOW,
    ),
  ).rejects.toThrow(/UNIQUE/);
});

it("duplicate attempt+problem submission is rejected", async () => {
  await expect(
    run("INSERT INTO submissions (id, attempt_id, problem_id, code, submitted_at) VALUES ('s2','a1','p1','z',?)", NOW),
  ).rejects.toThrow(/UNIQUE/);
});

it("visibility check rejects unknown value", async () => {
  await expect(
    run(
      "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric," +
        " reference_solution, test_cases, starter_code, created_at) VALUES ('p2', NULL, 'public', 's','f','[]','{}','r','[]','c',?)",
      NOW,
    ),
  ).rejects.toThrow(/CHECK/);
});

import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { AlreadySubmitted, NameTaken, createAttempt } from "../src/db/attempts";
import { getJob, getSubmissionBundle, insertSubmissionWithJob, insertSubmissionsWithJobs, setJobStatus } from "../src/db/jobs";

const run = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).run();
const NOW = "2026-11-26T00:00:00Z";

beforeAll(async () => {
  await run("INSERT INTO teachers (id, email, created_at) VALUES ('jt','jt@x.com',?)", NOW);
  await run(
    "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric, reference_solution, test_cases, starter_code, created_at)" +
      " VALUES ('jp', NULL, 'system', 'stmt','fn','[]','{}','r','[]','c',?)", NOW);
  for (const id of ["je1", "je2"]) {
    await run("INSERT INTO exams (id, teacher_id, title, student_token, deadline, time_limit_seconds, created_at) VALUES (?, 'jt','T',?,NULL,600,?)", id, `tok-${id}`, NOW);
  }
});

const newAttempt = (exam: string, name: string) => createAttempt(env.DB, exam, name, new Date());

describe("grading jobs", () => {
  it("a job is created queued together with the submission", async () => {
    const a = await newAttempt("je1", "Job One");
    const sid = await insertSubmissionWithJob(env.DB, { attemptId: a.attempt_id, problemId: "jp", code: "x" });
    expect(await getJob(env.DB, sid)).toMatchObject({ submission_id: sid, status: "queued", attempts: 0, error: null, audit_key: null });
  });

  it("a second submission for the same attempt and problem throws AlreadySubmitted and adds no job", async () => {
    const a = await newAttempt("je1", "Job Two");
    await insertSubmissionWithJob(env.DB, { attemptId: a.attempt_id, problemId: "jp", code: "x" });
    await expect(insertSubmissionWithJob(env.DB, { attemptId: a.attempt_id, problemId: "jp", code: "y" })).rejects.toBeInstanceOf(AlreadySubmitted);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM grading_jobs j JOIN submissions s ON s.id = j.submission_id WHERE s.attempt_id = ?").bind(a.attempt_id).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("setJobStatus updates status, error, audit key and the attempt counter", async () => {
    const a = await newAttempt("je1", "Job Three");
    const sid = await insertSubmissionWithJob(env.DB, { attemptId: a.attempt_id, problemId: "jp", code: "x" });
    await setJobStatus(env.DB, sid, "grading", { bumpAttempts: true });
    await setJobStatus(env.DB, sid, "done", { auditKey: `audit/${sid}.json` });
    expect(await getJob(env.DB, sid)).toMatchObject({ status: "done", attempts: 1, audit_key: `audit/${sid}.json` });
    await setJobStatus(env.DB, sid, "failed", { error: "boom" });
    expect((await getJob(env.DB, sid))?.error).toBe("boom");
  });

  it("an unknown status is rejected by the database", async () => {
    const a = await newAttempt("je1", "Job Four");
    const sid = await insertSubmissionWithJob(env.DB, { attemptId: a.attempt_id, problemId: "jp", code: "x" });
    await expect(setJobStatus(env.DB, sid, "bogus" as never)).rejects.toThrow(/CHECK/);
  });

  it("getSubmissionBundle returns the submission with its problem, null when unknown", async () => {
    const a = await newAttempt("je1", "Job Five");
    const sid = await insertSubmissionWithJob(env.DB, { attemptId: a.attempt_id, problemId: "jp", code: "THE CODE" });
    const b = await getSubmissionBundle(env.DB, sid);
    expect(b?.submission).toMatchObject({ id: sid, code: "THE CODE", problem_id: "jp" });
    expect(b?.problem.func_name).toBe("fn");
    expect(await getSubmissionBundle(env.DB, "nope")).toBeNull();
  });
});

describe("batch insert", () => {
  const rows = async (attemptId: string) =>
    (await env.DB.prepare("SELECT (SELECT count(*) FROM submissions WHERE attempt_id = ?1) AS s, (SELECT count(*) FROM grading_jobs j JOIN submissions s ON s.id = j.submission_id WHERE s.attempt_id = ?1) AS j").bind(attemptId).first<{ s: number; j: number }>())!;

  it("creates one queued job per item and returns the submission ids in order", async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric, reference_solution, test_cases, starter_code, created_at) VALUES ('jp2', NULL, 'system', 's2','fn2','[]','{}','r','[]','c',?)").bind(NOW).run();
    const a = await newAttempt("je1", "Batch One");
    const ids = await insertSubmissionsWithJobs(env.DB, { attemptId: a.attempt_id, items: [{ problemId: "jp", code: "a" }, { problemId: "jp2", code: "b" }] });
    expect(ids).toHaveLength(2);
    expect((await getSubmissionBundle(env.DB, ids[1]))?.submission).toMatchObject({ problem_id: "jp2", code: "b" });
    expect(await rows(a.attempt_id)).toEqual({ s: 2, j: 2 });
    expect((await getJob(env.DB, ids[0]))?.status).toBe("queued");
  });

  it("a conflict rolls back the whole batch and throws AlreadySubmitted", async () => {
    const a = await newAttempt("je1", "Batch Two");
    await insertSubmissionWithJob(env.DB, { attemptId: a.attempt_id, problemId: "jp2", code: "old" });
    await expect(insertSubmissionsWithJobs(env.DB, { attemptId: a.attempt_id, items: [{ problemId: "jp", code: "a" }, { problemId: "jp2", code: "b" }] })).rejects.toBeInstanceOf(AlreadySubmitted);
    expect(await rows(a.attempt_id)).toEqual({ s: 1, j: 1 }); // only the earlier one: nothing from the failed batch
  });
});

describe("unique attempt names", () => {
  it("rejects the same name in one exam, ignoring case and spaces", async () => {
    await newAttempt("je2", "An Nguyen");
    await expect(newAttempt("je2", "  an nguyen ")).rejects.toBeInstanceOf(NameTaken);
  });

  it("allows the same name in a different exam", async () => {
    await newAttempt("je1", "Shared Name");
    await expect(newAttempt("je2", "Shared Name")).resolves.toHaveProperty("receipt_code");
  });
});

describe("effective rubric in the grading bundle", () => {
  const PROBLEM_RUBRIC = { correctness: 100, efficiency: 0, code_style: 0, edge_case_handling: 0 };
  const EXAM_RUBRIC = { correctness: 10, efficiency: 20, code_style: 30, edge_case_handling: 40 };

  beforeAll(async () => {
    await run(
      "INSERT INTO problems (id, owner_teacher_id, visibility, statement, func_name, param_names, rubric, reference_solution, test_cases, starter_code, created_at)" +
        " VALUES ('jr', NULL, 'system', 'stmt','fn','[]',?, 'r','[]','c',?)", JSON.stringify(PROBLEM_RUBRIC), NOW);
    await run("INSERT INTO exams (id, teacher_id, title, student_token, deadline, time_limit_seconds, created_at, rubric) VALUES ('jre1','jt','T','tok-jre1',NULL,600,?,?)", NOW, JSON.stringify(EXAM_RUBRIC));
    await run("INSERT INTO exams (id, teacher_id, title, student_token, deadline, time_limit_seconds, created_at) VALUES ('jre2','jt','T','tok-jre2',NULL,600,?)", NOW);
  });

  const bundleFor = async (exam: string, name: string) => {
    const a = await createAttempt(env.DB, exam, name, new Date());
    const sid = await insertSubmissionWithJob(env.DB, { attemptId: a.attempt_id, problemId: "jr", code: "x" });
    return (await getSubmissionBundle(env.DB, sid))!;
  };

  it("uses the exam's rubric when the exam has one", async () => {
    expect((await bundleFor("jre1", "Rub One")).problem.rubric).toEqual(EXAM_RUBRIC);
  });

  it("uses the problem's own rubric when the exam has none, and never changes the problem row", async () => {
    expect((await bundleFor("jre2", "Rub Two")).problem.rubric).toEqual(PROBLEM_RUBRIC);
    const row = await env.DB.prepare("SELECT rubric FROM problems WHERE id = 'jr'").first<{ rubric: string }>();
    expect(JSON.parse(row!.rubric)).toEqual(PROBLEM_RUBRIC);
  });
});

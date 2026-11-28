import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, toCsv } from "../src/csv";
import { seedGradedAttempt } from "./appeals_fixture";

describe("csvCell", () => {
  it("passes plain text and numbers through, blank for null", () => {
    expect(csvCell("Nguyễn Văn Ánh")).toBe("Nguyễn Văn Ánh");
    expect(csvCell(65.5)).toBe("65.5");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
  });
  it("quotes commas, quotes and line breaks, doubling inner quotes", () => {
    expect(csvCell("Lê, Văn")).toBe('"Lê, Văn"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("prefixes an apostrophe on formula lead-ins", () => {
    for (const s of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(s).replace(/^"/, "")[0]).toBe("'");
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });
  it("toCsv starts with a BOM and uses CRLF", () => {
    const out = toCsv([["a", "b"], [1, null]]);
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out).toBe(CSV_BOM + "a,b\r\n1,\r\n");
  });
});

describe("GET /api/teacher/exams/:id/export.csv", () => {
  const parse = (text: string) => text.replace(CSV_BOM, "").trim().split("\r\n");

  it("one row per attempt with latest score, dimensions and times", async () => {
    const s = await seedGradedAttempt({ teacher: "exp1@x.com", name: "Nguyễn Văn Ánh" });
    const r = await s.call("GET", `/api/teacher/exams/${s.examId}/export.csv`, { as: "exp1@x.com" });
    expect(r.status).toBe(200);
    // (the BOM itself is covered by toCsv above: Response.text() strips it, so it cannot be seen here)
    const lines = parse(r.text);
    expect(lines[0]).toBe("Học viên,Câu 1,Tổng điểm,Đúng sai,Hiệu năng,Phong cách code,Trường hợp biên,Bắt đầu lúc,Nộp lúc");
    expect(lines).toHaveLength(2);
    const cells = lines[1].split(",");
    expect(cells.slice(0, 4)).toEqual(["Nguyễn Văn Ánh", "60", "60", "60"]);
    expect(cells[4]).toBe(""); // the fixture's grader returns only a correctness sub-score
  });

  it("includes a teacher adjustment and guards formula-like names", async () => {
    const s = await seedGradedAttempt({ teacher: "exp2@x.com", name: "=cmd|' /C calc'!A0" });
    await env.DB.prepare(
      "INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, author, reason, created_at)" +
        " VALUES ('rev-exp2', ?, 1, 'teacher', 95, '{\"correctness\":0.95}', '{}', 't', 'fair', '2026-11-26T00:00:00Z')",
    ).bind(s.submissionId).run();
    const r = await s.call("GET", `/api/teacher/exams/${s.examId}/export.csv`, { as: "exp2@x.com" });
    const row = parse(r.text)[1];
    expect(row.startsWith("'=cmd")).toBe(true);
    expect(row).toContain(",95,95,95,");
  });

  it("leaves total blank while a question is ungraded", async () => {
    const s = await seedGradedAttempt({ teacher: "exp3@x.com", graded: false });
    const r = await s.call("GET", `/api/teacher/exams/${s.examId}/export.csv`, { as: "exp3@x.com" });
    expect(parse(r.text)[1].split(",").slice(1, 5)).toEqual(["", "", "", ""]);
  });

  it("404 for another teacher's exam and for an unknown one; 401 without login", async () => {
    const s = await seedGradedAttempt({ teacher: "exp4@x.com" });
    expect((await s.call("GET", `/api/teacher/exams/${s.examId}/export.csv`, { as: "other-exp4@x.com" })).status).toBe(404);
    expect((await s.call("GET", `/api/teacher/exams/nope/export.csv`, { as: "exp4@x.com" })).status).toBe(404);
    expect((await s.call("GET", `/api/teacher/exams/${s.examId}/export.csv`)).status).toBe(401);
  });
});

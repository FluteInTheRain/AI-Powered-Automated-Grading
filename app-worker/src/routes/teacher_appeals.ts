import { Hono } from "hono";
import { decideAppeal, getAppealDetail, listExamAppeals, markUnderReview, type Decision } from "../db/appeals";
import { getOwnExam } from "../db/exams";
import type { AppEnv } from "../index";

const MAX_NOTE = 1000;
const DECISIONS: readonly string[] = ["upheld", "rejected", "adjusted"];
const notFound = { detail: "Unknown appeal" } as const;

/** Revision 0 is the AI's grading; its stored JSON is the structured result the teacher reads first. Null when it cannot be read. */
function aiResult(revisions: { revision: number; detail: string | null }[]): unknown {
  const first = revisions.find((r) => r.revision === 0);
  if (!first?.detail) return null;
  try { return JSON.parse(first.detail); } catch { return null; }
}

/** The AI call log from R2, or null when the object is missing or unreadable (the detail must still open). */
async function readAudit(audit: R2Bucket, key: string | null): Promise<{ call_log: unknown[] } | null> {
  if (!key) return null;
  try {
    const obj = await audit.get(key);
    if (!obj) return null;
    const parsed = (await obj.json()) as { call_log?: unknown[] };
    return { call_log: Array.isArray(parsed.call_log) ? parsed.call_log : [] };
  } catch {
    return null;
  }
}

export function teacherAppealRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/exams/:id/appeals", async (c) => {
    const exam = await getOwnExam(c.env.DB, c.get("teacher").id, c.req.param("id"));
    if (!exam) return c.json({ detail: "Unknown exam" }, 404);
    return c.json(await listExamAppeals(c.env.DB, exam.id));
  });

  r.get("/appeals/:appealId", async (c) => {
    const d = await getAppealDetail(c.env.DB, c.req.param("appealId"));
    if (!d || d.teacher_id !== c.get("teacher").id) return c.json(notFound, 404);
    const { teacher_id: _t, audit_key, revisions, ...view } = d;
    return c.json({
      ...view,
      revisions: revisions.map(({ detail: _d, ...rest }) => rest),
      ai_result: aiResult(revisions),
      audit: await readAudit(c.env.AUDIT, audit_key),
    });
  });

  /** Looks the appeal up and answers 404 for someone else's, so an id never reveals another teacher's data. */
  const ownAppealId = async (c: { env: AppEnv["Bindings"]; get: (k: "teacher") => { id: string }; req: { param: (n: string) => string } }) => {
    const d = await getAppealDetail(c.env.DB, c.req.param("appealId"));
    return d && d.teacher_id === c.get("teacher").id ? d.id : null;
  };

  r.post("/appeals/:appealId/review", async (c) => {
    const id = await ownAppealId(c);
    if (!id) return c.json(notFound, 404);
    if (!(await markUnderReview(c.env.DB, id))) return c.json({ detail: "Only an open appeal can be taken for review." }, 409);
    return c.json({ status: "under_review" });
  });

  r.post("/appeals/:appealId/decision", async (c) => {
    const id = await ownAppealId(c);
    if (!id) return c.json(notFound, 404);
    const b: any = await c.req.json().catch(() => null);
    const bad = (detail: string) => c.json({ detail }, 400);
    if (typeof b?.decision !== "string" || !DECISIONS.includes(b.decision)) return bad("decision must be upheld, rejected or adjusted");
    const note = typeof b.note === "string" ? b.note.trim() : "";
    if (!note || note.length > MAX_NOTE) return bad(`note must be 1-${MAX_NOTE} characters`);
    const decision = b.decision as Decision;
    if (decision === "adjusted" && !(typeof b.score === "number" && Number.isFinite(b.score) && b.score >= 0 && b.score <= 100)) {
      return bad("score must be a number from 0 to 100 when the decision is adjusted");
    }
    const result = await decideAppeal(c.env.DB, {
      id, decision, note, score: decision === "adjusted" ? b.score : undefined, teacherEmail: c.get("teacher").email, now: new Date(),
    });
    if (result === "already_decided") return c.json({ detail: "This appeal was already decided." }, 409);
    return c.json({ status: decision });
  });

  return r;
}

import { Hono } from "hono";
import { insertProblem, insertProblems, listBank, listOwnProblems, ownTitles, type NewProblem } from "../db/problems";
import { GraderError, previewProblem, toClientError, validateProblem } from "../grader";
import { checkNewProblem, isFieldError, type FieldError } from "../problem_input";
import type { AppEnv } from "../index";

function parseNewProblem(b: unknown): NewProblem | string {
  const r = checkNewProblem(b);
  return isFieldError(r) ? r.message : r;
}

export const IMPORT_MAX_ITEMS = 20; // one grader call per item; stays well under the Free plan's 50 subrequests
export const IMPORT_MAX_BYTES = 256 * 1024;
const DEFAULT_RUBRIC = { correctness: 40, efficiency: 20, code_style: 20, edge_case_handling: 20 };
type ImportError = FieldError & { index: number };

export function teacherProblemRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get("/bank", async (c) => c.json(await listBank(c.env.DB)));
  r.get("/problems", async (c) => c.json(await listOwnProblems(c.env.DB, c.get("teacher").id)));

  r.post("/problems/preview", async (c) => {
    try {
      return c.json(await previewProblem(c.env, await c.req.json()));
    } catch (e) {
      if (!(e instanceof GraderError)) throw e;
      const { status, detail } = toClientError(e);
      return c.json({ detail }, status);
    }
  });

  r.post("/problems", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseNewProblem(body);
    if (typeof parsed === "string") return c.json({ detail: parsed }, 400);
    try {
      await validateProblem(c.env, parsed);
    } catch (e) {
      if (!(e instanceof GraderError)) throw e;
      const { status, detail } = toClientError(e);
      return c.json({ detail }, status);
    }
    return c.json({ id: await insertProblem(c.env.DB, c.get("teacher").id, parsed) });
  });

  r.post("/problems/import", async (c) => {
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > IMPORT_MAX_BYTES) return c.json({ detail: `File too large (max ${IMPORT_MAX_BYTES / 1024} KB)` }, 413);
    const text = await c.req.text();
    if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) return c.json({ detail: `File too large (max ${IMPORT_MAX_BYTES / 1024} KB)` }, 413);
    let doc: any;
    try { doc = JSON.parse(text); } catch { return c.json({ detail: "File is not valid JSON" }, 400); }
    const items: unknown = Array.isArray(doc) ? doc : doc?.problems;
    if (!Array.isArray(items) || items.length === 0) return c.json({ detail: 'File must be {"problems": [...]} with at least one problem' }, 400);
    if (items.length > IMPORT_MAX_ITEMS) return c.json({ detail: `Too many problems (max ${IMPORT_MAX_ITEMS} per file)` }, 413);

    const teacher = c.get("teacher");
    const errors: ImportError[] = [];
    const ok: { index: number; p: NewProblem }[] = [];
    const taken = await ownTitles(c.env.DB, teacher.id);
    const seen = new Map<string, number>();
    items.forEach((item, index) => {
      // Missing rubric falls back to the default weights; everything else is the same strict check as a single create.
      const parsed = checkNewProblem(item && typeof item === "object" && !Array.isArray(item) && !("rubric" in item) ? { ...item, rubric: DEFAULT_RUBRIC } : item);
      if (isFieldError(parsed)) { errors.push({ index, ...parsed }); return; }
      const key = parsed.title.toLowerCase();
      if (seen.has(key)) errors.push({ index, field: "title", message: `Duplicate title in file (same as item ${seen.get(key)})` });
      else if (taken.has(key)) errors.push({ index, field: "title", message: "You already have a problem with this title" });
      else { seen.set(key, index); ok.push({ index, p: parsed }); }
    });

    // Only well-formed items reach the grader, which runs the reference solution against the test cases.
    try {
      await Promise.all(ok.map(async ({ index, p }) => {
        try { await validateProblem(c.env, p); } catch (e) {
          if (!(e instanceof GraderError)) throw e;
          const { status, detail } = toClientError(e);
          if (status !== 400) throw e;
          errors.push({ index, field: "test_cases", message: detail });
        }
      }));
    } catch (e) {
      if (!(e instanceof GraderError)) throw e;
      return c.json({ detail: toClientError(e).detail }, 502);
    }
    if (errors.length > 0) {
      errors.sort((a, b) => a.index - b.index);
      return c.json({ detail: `${errors.length} error(s); nothing was imported`, errors }, 400);
    }
    const ids = await insertProblems(c.env.DB, teacher.id, ok.map((x) => x.p));
    return c.json({ imported: ids.length, ids });
  });
  return r;
}

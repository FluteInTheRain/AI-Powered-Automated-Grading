import { Hono } from "hono";
import { getSettings, putSettings, type TeacherSettings } from "../db/teachers";
import type { AppEnv } from "../index";
import { parseRubric } from "../rubric";

/** Only the known fields survive; anything invalid is an error message. */
function parseSettings(b: any): TeacherSettings | string {
  if (!b || typeof b !== "object" || Array.isArray(b)) return "Body must be a JSON object";
  const out: TeacherSettings = {};
  if (b.default_rubric !== undefined) {
    const rubric = parseRubric(b.default_rubric);
    if (typeof rubric === "string") return rubric;
    out.default_rubric = rubric;
  }
  if (b.default_time_limit_seconds !== undefined) {
    if (!Number.isInteger(b.default_time_limit_seconds) || b.default_time_limit_seconds <= 0) {
      return "default_time_limit_seconds must be a positive integer";
    }
    out.default_time_limit_seconds = b.default_time_limit_seconds;
  }
  return out;
}

export function teacherSettingsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get("/settings", async (c) => c.json(await getSettings(c.env.DB, c.get("teacher").id)));
  r.put("/settings", async (c) => {
    const parsed = parseSettings(await c.req.json().catch(() => null));
    if (typeof parsed === "string") return c.json({ detail: parsed }, 400);
    await putSettings(c.env.DB, c.get("teacher").id, parsed);
    return c.json(parsed);
  });
  return r;
}

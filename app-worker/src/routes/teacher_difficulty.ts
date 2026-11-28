import { Hono } from "hono";
import { getDifficultyCalibration } from "../db/difficulty";
import { BANDS, MIN_ATTEMPTS } from "../difficulty";
import type { AppEnv } from "../index";

/** A hint about declared difficulty labels, from the teacher's own exams only; it never edits a label. */
export function teacherDifficultyRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get("/difficulty-calibration", async (c) =>
    c.json({ min_attempts: MIN_ATTEMPTS, bands: BANDS, problems: await getDifficultyCalibration(c.env.DB, c.get("teacher").id) }));
  return r;
}

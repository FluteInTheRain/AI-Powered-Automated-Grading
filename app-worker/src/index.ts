import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import { requireTeacher } from "./auth";
import { APPEAL_EXPIRY_DAYS, expireStaleAppeals } from "./db/appeals";
import { runCanary } from "./canary";
import { queue } from "./jobs";
import { verifyTurnstile, type TurnstileVerifier } from "./turnstile";
import { syntaxRoutes } from "./routes/syntax";
import { studentRoutes } from "./routes/student";
import { studentAppealRoutes } from "./routes/student_appeals";
import { featureMap, requireFeature } from "./flags";
import { isAdmin } from "./admin";
import { teacherAdminRoutes } from "./routes/teacher_admin";
import { teacherAppealRoutes } from "./routes/teacher_appeals";
import { teacherExamRoutes } from "./routes/teacher_exams";
import { teacherProblemRoutes } from "./routes/teacher_problems";
import { teacherSettingsRoutes } from "./routes/teacher_settings";
import type { Env, Teacher } from "./env";

export type AppDeps = { keyResolver?: JWTVerifyGetKey; now?: () => Date; turnstile?: TurnstileVerifier; fetchFn?: typeof fetch };
export type AppEnv = { Bindings: Env; Variables: { teacher: Teacher } };

export function createApp(deps: AppDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/api", syntaxRoutes());
  app.use("/api/exam/:token/attempts/by-receipt/:receipt/appeals", requireFeature("appeals"));
  app.route("/api/exam", studentRoutes(deps.now ?? (() => new Date()), deps.turnstile ?? verifyTurnstile));
  app.route("/api/exam", studentAppealRoutes(deps.now ?? (() => new Date()), deps.turnstile ?? verifyTurnstile));
  app.use("/api/teacher/*", requireTeacher(deps));
  app.get("/api/teacher/me", (c) => c.json({ ...c.get("teacher"), is_admin: isAdmin(c.env, c.get("teacher").email), features: featureMap(c.env) }));
  app.use("/api/teacher/exams/:id/similarity", requireFeature("similarity"));
  app.use("/api/teacher/exams/:id/export.csv", requireFeature("csv_export"));
  app.use("/api/teacher/problems/import", requireFeature("bulk_import"));
  app.use("/api/teacher/exams/:id/appeals", requireFeature("appeals"));
  app.use("/api/teacher/appeals/*", requireFeature("appeals"));
  app.route("/api/teacher", teacherProblemRoutes());
  app.route("/api/teacher", teacherExamRoutes());
  app.route("/api/teacher", teacherSettingsRoutes());
  app.route("/api/teacher", teacherAppealRoutes());
  app.route("/api/teacher", teacherAdminRoutes(deps.fetchFn));
  return app;
}

export { AttemptDO } from "./attempt_do";

/** Daily cron: open appeals nobody decided within APPEAL_EXPIRY_DAYS become expired, then the determinism canary runs. */
async function scheduled(_controller: ScheduledController, env: Env): Promise<void> {
  try {
    const expired = await expireStaleAppeals(env.DB, new Date(Date.now() - APPEAL_EXPIRY_DAYS * 86_400_000));
    console.log(`appeals cron: expired ${expired} stale appeal(s)`);
  } finally {
    await runCanary(env, new Date()); // never throws, and runs even if the expiry failed
  }
}

export default { fetch: createApp().fetch, queue, scheduled };

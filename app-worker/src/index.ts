import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import { requireTeacher } from "./auth";
import { syntaxRoutes } from "./routes/syntax";
import { studentRoutes } from "./routes/student";
import { teacherExamRoutes } from "./routes/teacher_exams";
import { teacherProblemRoutes } from "./routes/teacher_problems";
import type { Env, Teacher } from "./env";

export type AppDeps = { keyResolver?: JWTVerifyGetKey; now?: () => Date };
export type AppEnv = { Bindings: Env; Variables: { teacher: Teacher } };

export function createApp(deps: AppDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/api", syntaxRoutes());
  app.route("/api/exam", studentRoutes(deps.now ?? (() => new Date())));
  app.use("/api/teacher/*", requireTeacher(deps));
  app.get("/api/teacher/me", (c) => c.json(c.get("teacher")));
  app.route("/api/teacher", teacherProblemRoutes());
  app.route("/api/teacher", teacherExamRoutes());
  return app;
}

export { AttemptDO } from "./attempt_do";
import { queue } from "./jobs";

export default { fetch: createApp().fetch, queue };

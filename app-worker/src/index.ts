import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import { requireTeacher } from "./auth";
import type { Env, Teacher } from "./env";

export type AppDeps = { keyResolver?: JWTVerifyGetKey };
export type AppEnv = { Bindings: Env; Variables: { teacher: Teacher } };

export function createApp(deps: AppDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/health", (c) => c.json({ ok: true }));
  app.use("/api/teacher/*", requireTeacher(deps));
  app.get("/api/teacher/me", (c) => c.json(c.get("teacher")));
  return app;
}

export default { fetch: createApp().fetch };

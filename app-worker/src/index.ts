import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import type { Env, Teacher } from "./env";

export type AppDeps = { keyResolver?: JWTVerifyGetKey };
export type AppEnv = { Bindings: Env; Variables: { teacher: Teacher } };

export function createApp(_deps: AppDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}

export default { fetch: createApp().fetch };

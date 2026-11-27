import { Hono } from "hono";
import { isAdmin } from "../admin";
import { queryHealth } from "../analytics_sql";
import { canaryHistory } from "../db/canary";
import { overturnStats } from "../db/overturn";
import type { AppEnv } from "../index";

export const OVERTURN_LABEL = "overturn signal (selection-biased, single rater)";

export function teacherAdminRoutes(fetchFn?: typeof fetch): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get("/admin/metrics", async (c) => {
    if (!isAdmin(c.env, c.get("teacher").email)) return c.json({ detail: "Not allowed" }, 403);
    const [canary, overturn, health] = await Promise.all([
      canaryHistory(c.env.DB, 30), overturnStats(c.env.DB), queryHealth(c.env, fetchFn),
    ]);
    return c.json({ canary, overturn, health, label: OVERTURN_LABEL });
  });
  return r;
}

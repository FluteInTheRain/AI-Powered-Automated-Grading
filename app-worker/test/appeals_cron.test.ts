import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { createAppeal, decideAppeal } from "../src/db/appeals";
import type { Env } from "../src/env";
import worker from "../src/index";
import { seedGradedAttempt } from "./appeals_fixture";

const DAY = 86_400_000;
const statusOf = async (id: string) => (await env.DB.prepare("SELECT status FROM appeals WHERE id = ?").bind(id).first<any>()).status;

it("the daily cron expires open appeals older than 14 days and leaves the rest", async () => {
  const [stale, fresh, decided] = [await seedGradedAttempt(), await seedGradedAttempt(), await seedGradedAttempt()];
  const old = new Date(Date.now() - 15 * DAY);
  const staleId = await createAppeal(env.DB, { submissionId: stale.submissionId, message: "m", now: old });
  const freshId = await createAppeal(env.DB, { submissionId: fresh.submissionId, message: "m", now: new Date(Date.now() - 13 * DAY) });
  const decidedId = await createAppeal(env.DB, { submissionId: decided.submissionId, message: "m", now: old });
  await decideAppeal(env.DB, { id: decidedId, decision: "upheld", note: "n", teacherEmail: "t@x.com", now: new Date() });

  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await worker.scheduled({} as ScheduledController, env as unknown as Env);
  const logged = log.mock.calls.map((c) => String(c[0]));
  log.mockRestore();
  expect(logged).toContain("appeals cron: expired 1 stale appeal(s)");

  expect(await statusOf(staleId)).toBe("expired");
  expect(await statusOf(freshId)).toBe("open");
  expect(await statusOf(decidedId)).toBe("upheld");
});

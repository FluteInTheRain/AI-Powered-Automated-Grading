import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

const GRACE_MS = 10_000; // slack for network latency on the last request

/**
 * One object per exam attempt (addressed by the attempt id): the authoritative clock and a
 * per-question "claim" so only one submit per question is in flight at a time.
 * Read-modify-write below needs no extra locking: storage calls close the input gate, so no
 * other request runs between a get() and the put() that follows it.
 */
export class AttemptDO extends DurableObject<Env> {
  /** Sets the end time once; a second call keeps the first start. */
  async begin(limitSeconds: number, nowMs: number): Promise<void> {
    if ((await this.ctx.storage.get<number>("endsAt")) !== undefined) return;
    await this.ctx.storage.put("endsAt", nowMs + limitSeconds * 1000);
  }

  async check(nowMs: number): Promise<{ started: boolean; running: boolean; remainingSeconds: number }> {
    const endsAt = await this.ctx.storage.get<number>("endsAt");
    if (endsAt === undefined) return { started: false, running: false, remainingSeconds: 0 };
    return {
      started: true,
      running: nowMs <= endsAt + GRACE_MS,
      remainingSeconds: Math.max(0, Math.ceil((endsAt - nowMs) / 1000)),
    };
  }

  /** True for the first caller per question; false while the claim is held. */
  async claim(problemId: string): Promise<boolean> {
    const key = `claim:${problemId}`;
    if (await this.ctx.storage.get<boolean>(key)) return false;
    await this.ctx.storage.put(key, true);
    return true;
  }

  async release(problemId: string): Promise<void> {
    await this.ctx.storage.delete(`claim:${problemId}`);
  }
}

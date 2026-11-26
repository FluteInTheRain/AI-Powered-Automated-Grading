import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

const GRACE_MS = 10_000; // slack for network latency on the last request
const CLAIM_TTL_MS = 30_000; // a claim left by a crashed request frees itself after this long

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

  /** True for the first caller per question; false while a recent claim is held. A claim older than the TTL is stale. */
  async claim(problemId: string, nowMs: number): Promise<boolean> {
    const key = `claim:${problemId}`;
    const at = await this.ctx.storage.get<number>(key);
    if (at !== undefined && nowMs - at < CLAIM_TTL_MS) return false;
    await this.ctx.storage.put(key, nowMs);
    return true;
  }

  async release(problemId: string): Promise<void> {
    await this.ctx.storage.delete(`claim:${problemId}`);
  }
}

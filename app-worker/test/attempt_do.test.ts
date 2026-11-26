import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const stub = () => env.ATTEMPT.get(env.ATTEMPT.idFromName(crypto.randomUUID()));
const T0 = 1_000_000_000_000;

describe("AttemptDO", () => {
  it("says not started before begin", async () => {
    expect(await stub().check(T0)).toEqual({ started: false, running: false, remainingSeconds: 0 });
  });

  it("counts down from the limit after begin", async () => {
    const s = stub();
    await s.begin(600, T0);
    expect(await s.check(T0)).toEqual({ started: true, running: true, remainingSeconds: 600 });
    expect((await s.check(T0 + 100_000)).remainingSeconds).toBe(500);
  });

  it("stays running for ten seconds after the end, then stops", async () => {
    const s = stub();
    await s.begin(60, T0);
    const atEnd = await s.check(T0 + 60_000);
    expect(atEnd).toMatchObject({ running: true, remainingSeconds: 0 });
    expect((await s.check(T0 + 70_000)).running).toBe(true);
    expect((await s.check(T0 + 70_001)).running).toBe(false);
  });

  it("keeps the first start when begin is called twice", async () => {
    const s = stub();
    await s.begin(600, T0);
    await s.begin(60, T0 + 1_000_000);
    expect((await s.check(T0 + 100_000)).remainingSeconds).toBe(500);
  });

  it("claim succeeds once per question until released or expired", async () => {
    const s = stub();
    expect(await s.claim("p1", T0)).toBe(true);
    expect(await s.claim("p1", T0 + 1_000)).toBe(false);
    expect(await s.claim("p2", T0)).toBe(true);
    await s.release("p1");
    expect(await s.claim("p1", T0 + 2_000)).toBe(true);
    // a claim left behind by a crashed request frees itself after 30 seconds
    expect(await s.claim("p2", T0 + 29_000)).toBe(false);
    expect(await s.claim("p2", T0 + 31_000)).toBe(true);
  });

  it("two attempt ids do not share state", async () => {
    const a = stub();
    const b = stub();
    await a.begin(600, T0);
    await a.claim("p1", T0);
    expect((await b.check(T0)).started).toBe(false);
    expect(await b.claim("p1", T0)).toBe(true);
  });

  it("concurrent claims have exactly one winner", async () => {
    const s = stub();
    const results = await Promise.all(Array.from({ length: 5 }, () => s.claim("p1", T0)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

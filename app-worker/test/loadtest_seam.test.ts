import { describe, expect, it } from "vitest";
import { loadTestSkipsTurnstile } from "../src/routes/student";

const ctx = (flag: string | undefined, url: string) => ({ env: { LOADTEST_SKIP_TURNSTILE: flag }, req: { url } }) as any;

describe("load test seam (LOADTEST_SKIP_TURNSTILE)", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(loadTestSkipsTurnstile(ctx(undefined, "http://localhost:8787/x"))).toBe(false);
    expect(loadTestSkipsTurnstile(ctx("true", "http://localhost:8787/x"))).toBe(false);
  });
  it("works on localhost and 127.0.0.1", () => {
    expect(loadTestSkipsTurnstile(ctx("1", "http://localhost:8787/x"))).toBe(true);
    expect(loadTestSkipsTurnstile(ctx("1", "http://127.0.0.1:8787/x"))).toBe(true);
  });
  it("does nothing on a deployed hostname even when the flag is set", () => {
    expect(loadTestSkipsTurnstile(ctx("1", "https://teacher-app.khangnguyen.workers.dev/x"))).toBe(false);
    expect(loadTestSkipsTurnstile(ctx("1", "https://localhost.evil.example/x"))).toBe(false);
  });
});

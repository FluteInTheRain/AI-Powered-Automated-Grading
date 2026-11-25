import { describe, expect, it } from "vitest";
import { client, fakeGrader, jsonRes } from "./helpers";

describe("syntax check", () => {
  it("forwards the code and returns the grader's answer", async () => {
    const g = fakeGrader(() => jsonRes({ ok: false, message: "invalid syntax", line: 1 }));
    const r = await client(g.binding)("POST", "/api/syntax-check", { body: { code: "def f(:" } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: false, message: "invalid syntax", line: 1 });
    expect(g.calls[0]).toEqual({ name: "syntax-check", body: { code: "def f(:" } });
  });

  it.each([["non-string", { code: 5 }], ["missing", {}], ["too long", { code: "x".repeat(20001) }]])(
    "rejects %s code with 400 and never calls the grader",
    async (_n, body) => {
      const g = fakeGrader(() => jsonRes({ ok: true }));
      const r = await client(g.binding)("POST", "/api/syntax-check", { body });
      expect(r.status).toBe(400);
      expect(g.calls.length).toBe(0);
    },
  );
});

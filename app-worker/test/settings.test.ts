import { describe, expect, it } from "vitest";
import { client, fakeGrader, jsonRes } from "./helpers";

const call = client(fakeGrader(() => jsonRes({ ok: true })).binding);
const RUBRIC = { correctness: 50, efficiency: 20, code_style: 20, edge_case_handling: 10 };
const put = (as: string, body: unknown) => call("PUT", "/api/teacher/settings", { as, body });

describe("teacher settings", () => {
  it("is empty for a new teacher", async () => {
    const r = await call("GET", "/api/teacher/settings", { as: "set1@x.com" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({});
  });

  it("saves and returns the default rubric and time limit", async () => {
    const body = { default_rubric: RUBRIC, default_time_limit_seconds: 1800 };
    const saved = await put("set2@x.com", body);
    expect(saved.status).toBe(200);
    expect(saved.json).toEqual(body);
    expect((await call("GET", "/api/teacher/settings", { as: "set2@x.com" })).json).toEqual(body);
  });

  it("accepts a rubric alone and a time limit alone", async () => {
    expect((await put("set3@x.com", { default_rubric: RUBRIC })).json).toEqual({ default_rubric: RUBRIC });
    expect((await put("set3@x.com", { default_time_limit_seconds: 600 })).json).toEqual({ default_time_limit_seconds: 600 });
  });

  it.each([
    ["all-zero rubric", { default_rubric: { correctness: 0, efficiency: 0, code_style: 0, edge_case_handling: 0 } }],
    ["total below 100", { default_rubric: { correctness: 30, efficiency: 20, code_style: 20, edge_case_handling: 10 } }],
    ["total above 100", { default_rubric: { correctness: 60, efficiency: 20, code_style: 20, edge_case_handling: 10 } }],
    ["negative weight", { default_rubric: { ...RUBRIC, correctness: -1 } }],
    ["float weight", { default_rubric: { ...RUBRIC, correctness: 50.5 } }],
    ["missing key", { default_rubric: { correctness: 1, efficiency: 1, code_style: 1 } }],
    ["extra key", { default_rubric: { ...RUBRIC, bonus: 1 } }],
    ["string weight", { default_rubric: { ...RUBRIC, correctness: "50" } }],
    ["zero time limit", { default_time_limit_seconds: 0 }],
    ["float time limit", { default_time_limit_seconds: 1.5 }],
    ["not an object", [1, 2]],
  ])("rejects %s", async (_n, body) => {
    expect((await put("set4@x.com", body)).status).toBe(400);
  });

  it("keeps each teacher's settings private", async () => {
    await put("set5@x.com", { default_rubric: RUBRIC });
    expect((await call("GET", "/api/teacher/settings", { as: "set6@x.com" })).json).toEqual({});
  });
});

import { expect, it } from "vitest";
import { newId, newReceiptCode, newToken } from "../src/ids";

it("newToken is 32 hex chars and unique", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const t = newToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    seen.add(t);
  }
  expect(seen.size).toBe(1000);
});

it("newReceiptCode uses the unambiguous alphabet", () => {
  for (let i = 0; i < 200; i++) expect(newReceiptCode()).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
});

it("newId has no dashes", () => {
  expect(newId()).toMatch(/^[0-9a-f]{32}$/);
});

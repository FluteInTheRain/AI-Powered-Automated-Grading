import { expect, it } from "vitest";
import { computeTotal } from "../src/scoring";

it("weighted average", () => {
  expect(computeTotal([{ weight: 1, score: 80 }, { weight: 3, score: 60 }])).toBe(65);
});
it("empty list is 0", () => {
  expect(computeTotal([])).toBe(0);
});
it("single item is its score", () => {
  expect(computeTotal([{ weight: 2, score: 73.5 }])).toBe(73.5);
});
it("rounds to 2 decimals", () => {
  expect(computeTotal([{ weight: 1, score: 100 }, { weight: 1, score: 100 }, { weight: 1, score: 99 }])).toBe(99.67);
});

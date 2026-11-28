import { createMiddleware } from "hono/factory";
import type { Env } from "./env";

/** The kill switches. Everything is on unless named in DISABLED_FEATURES; a flag can only remove a feature. */
export const FEATURES = ["similarity", "csv_export", "bulk_import", "appeals"] as const;
export type Feature = (typeof FEATURES)[number];

const known = new Set<string>(FEATURES);
const warned = new Set<string>();

/** Parses the comma separated list: spaces and case ignored, duplicates collapse, unknown names are returned apart. */
export function parseDisabled(raw: string | undefined): { disabled: Set<Feature>; unknown: string[] } {
  const disabled = new Set<Feature>();
  const unknown: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    if (!name) continue;
    if (known.has(name)) disabled.add(name as Feature);
    else if (!unknown.includes(name)) unknown.push(name);
  }
  return { disabled, unknown };
}

/** Unknown names are logged once per isolate and per name, so a typo is visible without flooding the log. */
function warnUnknown(unknown: string[]): void {
  for (const name of unknown) {
    if (warned.has(name)) continue;
    warned.add(name);
    console.warn(`DISABLED_FEATURES: unknown feature "${name}" ignored (known: ${FEATURES.join(", ")})`);
  }
}

export function isEnabled(env: Pick<Env, "DISABLED_FEATURES">, name: Feature): boolean {
  const { disabled, unknown } = parseDisabled(env.DISABLED_FEATURES);
  warnUnknown(unknown);
  return !disabled.has(name);
}

export function featureMap(env: Pick<Env, "DISABLED_FEATURES">): Record<Feature, boolean> {
  return Object.fromEntries(FEATURES.map((f) => [f, isEnabled(env, f)])) as Record<Feature, boolean>;
}

/** Answers 404 before the handler runs, so a disabled feature touches no D1, R2 or queue binding. */
export const requireFeature = (name: Feature) =>
  createMiddleware<{ Bindings: Env }>(async (c, next) => {
    if (!isEnabled(c.env, name)) return c.json({ detail: "feature disabled" }, 404);
    await next();
  });

/** Test helper: forget which unknown names were already logged. */
export function resetWarned(): void {
  warned.clear();
}

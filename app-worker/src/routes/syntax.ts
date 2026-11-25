import { Hono } from "hono";
import { GraderError, checkSyntax, toClientError } from "../grader";
import type { AppEnv } from "../index";

const MAX_CODE = 20_000;

/** Public, stateless: lets the editor show Python syntax errors while typing. */
export function syntaxRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.post("/syntax-check", async (c) => {
    const b: any = await c.req.json().catch(() => null);
    if (typeof b?.code !== "string" || b.code.length > MAX_CODE) return c.json({ detail: "code must be a string of at most 20000 characters" }, 400);
    try {
      return c.json(await checkSyntax(c.env, b.code));
    } catch (e) {
      if (!(e instanceof GraderError)) throw e;
      const { status, detail } = toClientError(e);
      return c.json({ detail }, status);
    }
  });
  return r;
}

import { env } from "cloudflare:workers";
import { createApp } from "../src/index";

export type GraderCall = { name: string; body: any };

/** A fake GRADER service binding: `handler` answers per internal endpoint name. */
export function fakeGrader(handler: (name: string, body: any) => Response | Promise<Response>) {
  const calls: GraderCall[] = [];
  const binding = {
    fetch: async (url: string, init: RequestInit) => {
      const name = new URL(url).pathname.split("/").pop() as string;
      const body = JSON.parse(init.body as string);
      calls.push({ name, body });
      return handler(name, body);
    },
  } as unknown as Fetcher;
  return { binding, calls };
}

export const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Calls the app as a teacher (dev bypass) or anonymously (student routes). */
export function client(grader: Fetcher, now?: () => Date) {
  const app = createApp(now ? { now } : {});
  const e = { DB: env.DB, GRADER: grader, INTERNAL_TOKEN: "tok", ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "a", DEV_AUTH_BYPASS: "1" };
  return async (method: string, path: string, opts: { as?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.as) headers["X-Dev-Teacher"] = opts.as;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, e);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  };
}

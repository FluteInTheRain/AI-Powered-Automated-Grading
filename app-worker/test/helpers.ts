import { env } from "cloudflare:workers";
import { createApp } from "../src/index";
import type { Env } from "../src/env";
import { queue } from "../src/jobs";

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
export function client(grader: Fetcher, now?: () => Date, db?: D1Database, extra: Record<string, unknown> = {}) {
  const { turnstile, ...envExtra } = extra as { turnstile?: (token: string | undefined, ip: string | null) => Promise<boolean> };
  const app = createApp({ ...(now ? { now } : {}), turnstile: turnstile ? (_e, t, ip) => turnstile(t, ip) : async () => true });
  const allow = { limit: async () => ({ success: true }) };
  const e = {
    DB: db ?? env.DB, GRADER: grader, INTERNAL_TOKEN: "tok", ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "a",
    DEV_AUTH_BYPASS: "1", ATTEMPT: env.ATTEMPT, AUDIT: env.AUDIT, GRADING_QUEUE: fakeQueue().binding,
    RL_START: allow, RL_SYNTAX: allow, RL_ACTION: allow, TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET: "", TURNSTILE_HOSTNAMES: "",
    ...envExtra,
  };
  return async (method: string, path: string, opts: { as?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.as) headers["X-Dev-Teacher"] = opts.as;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, e);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  };
}

/** Wraps a D1 binding and counts prepare() calls (one per query). */
export function countingDb(db: D1Database) {
  let n = 0;
  const proxy = new Proxy(db, {
    get(t, k) {
      if (k === "prepare") return (...a: [string]) => { n++; return t.prepare(...a); };
      const v = (t as any)[k];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { db: proxy as D1Database, count: () => n };
}

export type FakeQueue = ReturnType<typeof fakeQueue>;

/** A queue binding that records messages; failNext() makes the next send throw. */
export function fakeQueue() {
  const sent: { submission_id: string }[] = [];
  let fail = false;
  return {
    sent,
    failNext() { fail = true; },
    binding: {
      send: async (m: { submission_id: string }) => {
        if (fail) { fail = false; throw new Error("queue down"); }
        sent.push(m);
      },
    } as unknown as Queue<{ submission_id: string }>,
  };
}

/** Runs the real queue consumer over everything the fake queue received. */
export async function drain(q: FakeQueue, graderBinding: Fetcher) {
  const e = { DB: env.DB, GRADER: graderBinding, INTERNAL_TOKEN: "tok", AUDIT: env.AUDIT } as unknown as Env;
  while (q.sent.length) {
    const body = q.sent.shift()!;
    const batch = { queue: "grading-jobs", messages: [{ id: "m", body, attempts: 1, ack() {}, retry() {} }] };
    await queue(batch as unknown as MessageBatch<{ submission_id: string }>, e);
  }
}

import type { AttemptDO } from "./attempt_do";

export type Env = {
  DB: D1Database;
  GRADING_QUEUE: Queue<{ submission_id: string }>;
  ATTEMPT: DurableObjectNamespace<AttemptDO>;
  AUDIT: R2Bucket;
  RL_START: RateLimit;
  RL_SYNTAX: RateLimit;
  RL_ACTION: RateLimit;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  /** Comma-separated hostnames Turnstile may report. */
  TURNSTILE_HOSTNAMES: string;
  GRADER: Fetcher;
  INTERNAL_TOKEN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Local development only (.dev.vars). Never set in wrangler.jsonc. */
  DEV_AUTH_BYPASS?: string;
};

export type Teacher = { id: string; email: string };

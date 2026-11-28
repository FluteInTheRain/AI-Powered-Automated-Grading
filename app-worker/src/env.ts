import type { AttemptDO } from "./attempt_do";

export type Env = {
  DB: D1Database;
  GRADING_QUEUE: Queue<{ submission_id: string }>;
  ATTEMPT: DurableObjectNamespace<AttemptDO>;
  AUDIT: R2Bucket;
  /** Analytics Engine dataset `grading_events`; optional so a missing binding never breaks grading. */
  METRICS?: AnalyticsEngineDataset;
  RL_START: RateLimit;
  RL_SYNTAX: RateLimit;
  RL_ACTION: RateLimit;
  /** Mutation test-suite checks (POST /api/teacher/problems/check-tests), keyed per teacher. */
  RL_CHECK: RateLimit;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  /** Comma-separated hostnames Turnstile may report. */
  TURNSTILE_HOSTNAMES: string;
  GRADER: Fetcher;
  INTERNAL_TOKEN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Comma-separated emails allowed on the developer metrics page. Set as a secret, never in wrangler.jsonc. */
  ADMIN_EMAILS?: string;
  /** Kill switches: comma-separated feature names to turn off (see flags.ts). Empty means everything on. */
  DISABLED_FEATURES?: string;
  CF_ACCOUNT_ID?: string;
  /** Read-only token (Account Analytics: Read) for the Analytics Engine SQL API. */
  CF_API_TOKEN?: string;
  /** Local development only (.dev.vars). Never set in wrangler.jsonc. */
  DEV_AUTH_BYPASS?: string;
};

export type Teacher = { id: string; email: string };

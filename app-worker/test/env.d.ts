declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GRADING_QUEUE: Queue<{ submission_id: string }>;
    ATTEMPT: DurableObjectNamespace<import("../src/attempt_do").AttemptDO>;
    AUDIT: R2Bucket;
    METRICS?: AnalyticsEngineDataset;
    RL_START: RateLimit;
    RL_SYNTAX: RateLimit;
    RL_ACTION: RateLimit;
    TURNSTILE_SECRET: string;
    TURNSTILE_SITE_KEY: string;
    TURNSTILE_HOSTNAMES: string;
    GRADER: Fetcher;
    INTERNAL_TOKEN: string;
    ACCESS_TEAM_DOMAIN: string;
    ACCESS_AUD: string;
    ADMIN_EMAILS?: string;
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
    DEV_AUTH_BYPASS?: string;
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}

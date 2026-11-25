declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GRADER: Fetcher;
    INTERNAL_TOKEN: string;
    ACCESS_TEAM_DOMAIN: string;
    ACCESS_AUD: string;
    DEV_AUTH_BYPASS?: string;
    TEST_MIGRATIONS: import("@cloudflare/vitest-plugin").D1Migration[];
  }
}

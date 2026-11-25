export type Env = {
  DB: D1Database;
  GRADER: Fetcher;
  INTERNAL_TOKEN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Local development only (.dev.vars). Never set in wrangler.jsonc. */
  DEV_AUTH_BYPASS?: string;
};

export type Teacher = { id: string; email: string };

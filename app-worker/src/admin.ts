import type { Env } from "./env";

/** True when the signed-in email is in the comma-separated ADMIN_EMAILS list (trimmed, case-insensitive). */
export function isAdmin(env: Pick<Env, "ADMIN_EMAILS">, email: string): boolean {
  const wanted = email.trim().toLowerCase();
  if (!wanted || !env.ADMIN_EMAILS) return false;
  return env.ADMIN_EMAILS.split(",").some((e) => e.trim().toLowerCase() === wanted);
}

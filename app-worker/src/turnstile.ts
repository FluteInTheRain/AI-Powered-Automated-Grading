import type { Env } from "./env";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerifier = (
  env: Pick<Env, "TURNSTILE_SECRET" | "TURNSTILE_HOSTNAMES">,
  token: string | undefined,
  ip: string | null,
) => Promise<boolean>;

/**
 * Server-side Turnstile check. Fails closed: a missing token or secret, a network error, an
 * unreadable answer, success=false, or a hostname outside TURNSTILE_HOSTNAMES all mean "no".
 * Tokens are single-use, so call this once per challenge.
 */
export async function verifyTurnstile(
  env: Pick<Env, "TURNSTILE_SECRET" | "TURNSTILE_HOSTNAMES">,
  token: string | undefined,
  ip: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!token || !env.TURNSTILE_SECRET) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetchFn(SITEVERIFY, { method: "POST", body: form });
    const data = (await res.json()) as { success?: boolean; hostname?: string };
    const allowed = (env.TURNSTILE_HOSTNAMES ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    return data.success === true && typeof data.hostname === "string" && allowed.includes(data.hostname);
  } catch {
    return false;
  }
}

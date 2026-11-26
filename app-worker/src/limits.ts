/** Wraps the Workers Rate Limiting binding. Counts are per Cloudflare location and approximate. */
export async function allow(limiter: RateLimit, key: string): Promise<boolean> {
  return (await limiter.limit({ key })).success;
}

export const TOO_MANY = { detail: "Too many requests, slow down." } as const;

/** Client address for per-IP limits; "unknown" outside Cloudflare (local runs and tests). */
export const clientIp = (req: { header(name: string): string | undefined }) => req.header("CF-Connecting-IP") ?? "unknown";

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { MiddlewareHandler } from "hono";
import { upsertTeacher } from "./db/teachers";
import type { AppEnv } from "./index";

const remoteKeys = new Map<string, JWTVerifyGetKey>();

function keysFor(teamDomain: string): JWTVerifyGetKey {
  let k = remoteKeys.get(teamDomain);
  if (!k) {
    k = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remoteKeys.set(teamDomain, k);
  }
  return k;
}

/** Teacher login: verify the Cloudflare Access JWT, then find or create the teacher. Fails closed. */
export function requireTeacher(deps: { keyResolver?: JWTVerifyGetKey } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const deny = () => c.json({ detail: "Not signed in" }, 401);
    let email: string | undefined;
    if (c.env.DEV_AUTH_BYPASS === "1") {
      email = c.req.header("X-Dev-Teacher") ?? undefined;
    } else {
      const jwt = c.req.header("Cf-Access-Jwt-Assertion");
      if (!jwt) return deny();
      try {
        const { payload } = await jwtVerify(jwt, deps.keyResolver ?? keysFor(c.env.ACCESS_TEAM_DOMAIN), {
          issuer: `https://${c.env.ACCESS_TEAM_DOMAIN}`,
          audience: c.env.ACCESS_AUD,
        });
        email = typeof payload.email === "string" ? payload.email : undefined;
      } catch {
        return deny();
      }
    }
    if (!email) return deny();
    c.set("teacher", await upsertTeacher(c.env.DB, email));
    await next();
  };
}

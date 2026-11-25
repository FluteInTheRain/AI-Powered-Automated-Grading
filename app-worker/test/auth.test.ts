import { env } from "cloudflare:workers";
import { SignJWT, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/index";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-123";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let other: Awaited<ReturnType<typeof generateKeyPair>>;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  other = await generateKeyPair("RS256");
});

function appEnv(extra: Record<string, string> = {}) {
  return { DB: env.DB, GRADER: env.GRADER, INTERNAL_TOKEN: "t", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...extra };
}

async function token(email: string, o: { aud?: string; iss?: string; exp?: string; key?: CryptoKey } = {}) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(o.iss ?? `https://${TEAM}`)
    .setAudience(o.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "5m")
    .sign(o.key ?? keys.privateKey);
}

const me = (headers: Record<string, string>, e = appEnv()) =>
  createApp({ keyResolver: async () => keys.publicKey }).request("/api/teacher/me", { headers }, e);

describe("Access login", () => {
  it("valid token returns me", async () => {
    const res = await me({ "Cf-Access-Jwt-Assertion": await token("valid@x.com") });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "valid@x.com" });
  });

  it("expired token is 401", async () => {
    const res = await me({ "Cf-Access-Jwt-Assertion": await token("exp@x.com", { exp: "-1m" }) });
    expect(res.status).toBe(401);
  });

  it("wrong audience is 401", async () => {
    expect((await me({ "Cf-Access-Jwt-Assertion": await token("a@x.com", { aud: "nope" }) })).status).toBe(401);
  });

  it("wrong issuer is 401", async () => {
    expect((await me({ "Cf-Access-Jwt-Assertion": await token("i@x.com", { iss: "https://evil.example" }) })).status).toBe(401);
  });

  it("token signed by another key is 401", async () => {
    expect((await me({ "Cf-Access-Jwt-Assertion": await token("k@x.com", { key: other.privateKey }) })).status).toBe(401);
  });

  it("missing header is 401", async () => {
    expect((await me({})).status).toBe(401);
  });

  it("dev header is ignored when bypass is off", async () => {
    expect((await me({ "X-Dev-Teacher": "dev@x.com" })).status).toBe(401);
  });

  it("dev header is accepted when bypass is on", async () => {
    const res = await me({ "X-Dev-Teacher": "dev2@x.com" }, appEnv({ DEV_AUTH_BYPASS: "1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "dev2@x.com" });
  });

  it("first login creates the teacher row, second login reuses it", async () => {
    const t = await token("once@x.com");
    const a = (await (await me({ "Cf-Access-Jwt-Assertion": t })).json()) as { id: string };
    const b = (await (await me({ "Cf-Access-Jwt-Assertion": t })).json()) as { id: string };
    expect(a.id).toBe(b.id);
    const rows = await env.DB.prepare("SELECT count(*) AS n FROM teachers WHERE email = 'once@x.com'").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("email is case-insensitive", async () => {
    const a = (await (await me({ "Cf-Access-Jwt-Assertion": await token("Case@X.com") })).json()) as { id: string; email: string };
    const b = (await (await me({ "Cf-Access-Jwt-Assertion": await token("case@x.com") })).json()) as { id: string };
    expect(a.email).toBe("case@x.com");
    expect(a.id).toBe(b.id);
  });
});

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/** Stub so the Durable Object migration can deploy; the real class arrives in plan Task 3. */
export class AttemptDO extends DurableObject<Env> {}

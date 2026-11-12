import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const uuid = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const pathPattern = new RegExp(`^${uuid}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|png|webp)$`);
const rpcPaths = new Set(["bandup_claim_band_logo_cleanup", "bandup_renew_band_logo_cleanup", "bandup_finish_band_logo_cleanup"]
  .map(name => `/rest/v1/rpc/${name}`));

export function cleanupRequestAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret) || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function cleanupConfiguration(env: NodeJS.ProcessEnv) {
  const ref = env.BANDUP_BAND_LOGO_CLEANUP_PROJECT_REF;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || !key) throw new Error("Worker configuration unavailable");
  const origin = `https://${ref}.supabase.co`;
  if (![origin, `${origin}/`].includes(env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("Worker configuration unavailable");
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) {
    let claims: { role?: string; ref?: string };
    try { claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")); }
    catch { throw new Error("Worker configuration unavailable"); }
    if (key.split(".").length !== 3 || claims.role !== "service_role" || (claims.ref && claims.ref !== ref)) {
      throw new Error("Worker configuration unavailable");
    }
  }
  return { origin, key };
}

// A second boundary prevents the privileged SDK from contacting Auth, other RPCs,
// table endpoints, other projects, avatars or arbitrary Storage endpoints.
export function cleanupFetch(origin: string, signal: AbortSignal, request: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = init?.method?.toUpperCase();
    let body: Record<string, unknown>;
    try { body = JSON.parse(typeof init?.body === "string" ? init.body : ""); }
    catch { throw new Error("Worker request rejected"); }
    let allowed = method === "POST" && rpcPaths.has(url.pathname);
    if (method === "POST" && url.pathname === "/storage/v1/object/list/band-logos") {
      allowed = typeof body.prefix === "string" && new RegExp(`^${uuid}$`).test(body.prefix)
        && body.limit === 100 && body.offset === 0;
    }
    if (method === "DELETE" && url.pathname === "/storage/v1/object/band-logos") {
      const paths = body.prefixes;
      allowed = Array.isArray(paths) && paths.length > 0 && paths.length <= 100
        && paths.every(path => typeof path === "string" && pathPattern.test(path))
        && new Set(paths.map(path => path.split("/")[0])).size === 1;
    }
    if (url.origin !== origin || url.search || url.hash || url.username || url.password || !allowed) {
      throw new Error("Worker request rejected");
    }
    return request(input, { ...init, cache: "no-store", redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(6000), ...(init?.signal ? [init.signal] : [])]) });
  };
}

export function createBandLogoCleanupClient(config: ReturnType<typeof cleanupConfiguration>, signal: AbortSignal) {
  return createClient(config.origin, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: "public" },
    global: { fetch: cleanupFetch(config.origin, signal) },
  });
}

import "server-only";
import { requirePublicationEnabled } from "@/lib/publication-control";

import { createClient } from "@supabase/supabase-js";
import { isLaboratoryHttpOrigin } from "../development-lab";

const unavailable = () => new Error("Não foi possível carregar a página pública.");

function publicConfiguration() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!value || !key) throw unavailable();

  try {
    const validateUrl = (input: string, endpoint: "public" | "internal") => {
      const url = new URL(input);
      const labHttp = isLaboratoryHttpOrigin(url.origin, endpoint);
      if (
        /[\u0000-\u0020\u007f]/.test(input) ||
        url.username || url.password || url.search || url.hash ||
        (url.protocol !== "https:" && !labHttp)
      ) throw unavailable();
      return url.origin;
    };
    const origin = validateUrl(value, "public");
    const internalValue = process.env.SUPABASE_INTERNAL_URL;
    const internalOrigin = internalValue === undefined
      ? origin
      : validateUrl(internalValue, "internal");

    // Accept publishable keys or legacy anon JWTs; never a privileged key.
    if (key === "sb_publishable_") throw unavailable();
    if (!key.startsWith("sb_publishable_")) {
      const parts = key.split(".");
      if (parts.length !== 3) throw unavailable();
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (payload.role !== "anon") throw unavailable();
    }
    return { origin, internalOrigin, key };
  } catch {
    throw unavailable();
  }
}

export async function readPublicBandRow(slug: string): Promise<{
  data: unknown;
  imageOrigin: string;
}> {
  requirePublicationEnabled();
  const { origin, internalOrigin, key } = publicConfiguration();
  const client = createClient(internalOrigin, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const { data, error } = await client
      .from("public_band_profiles")
      .select("name,slug,description,logo_url,links")
      .eq("slug", slug)
      .abortSignal(controller.signal)
      .maybeSingle();
    if (error) throw unavailable();
    return { data, imageOrigin: origin };
  } catch {
    // Do not propagate query details, credentials, or response payloads.
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}

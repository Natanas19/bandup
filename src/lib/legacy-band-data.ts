import type { SupabaseClient } from "@supabase/supabase-js";

export const LEGACY_BAND_COLUMNS = "id, name, description";
export const LEGACY_LINK_COLUMNS = "id, platform, url, created_at";
export type LegacyBandLink = { id: string; platform: string; url: string; created_at: string };
export type LegacyBandLinksResult = { status: "unavailable" } | {
  status: "ready"; bandName: string; role: "admin" | "member"; links: LegacyBandLink[];
};

export function readLegacyBandOverview(client: SupabaseClient, bandId: string) {
  return client.from("bands").select(LEGACY_BAND_COLUMNS).eq("id", bandId).maybeSingle();
}

// Authenticated caller only; membership is required before reading links.
// No publication columns, public views or write methods in this compatibility path.
export async function readLegacyBandLinks(client: SupabaseClient, bandId: string, userId: string): Promise<LegacyBandLinksResult> {
  const { data: membership, error: membershipError } = await client.from("band_members")
    .select("role").eq("band_id", bandId).eq("user_id", userId).maybeSingle();
  if (membershipError) throw new Error("Não foi possível verificar o acesso à banda.");
  if (!membership || (membership.role !== "admin" && membership.role !== "member")) return { status: "unavailable" };
  const { data: band, error: bandError } = await client.from("bands").select("name").eq("id", bandId).maybeSingle();
  if (bandError) throw new Error("Não foi possível carregar a banda.");
  if (!band) return { status: "unavailable" };
  const { data, error } = await client.from("social_links").select(LEGACY_LINK_COLUMNS)
    .eq("band_id", bandId).order("created_at", { ascending: true });
  if (error) throw new Error("Não foi possível carregar os links.");
  return { status: "ready", bandName: band.name, role: membership.role, links: (data ?? []) as LegacyBandLink[] };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMemberDisplayName } from "./display-name";
import { safeDiscoveryAvatar } from "./public-band-data";

// Opt in only after the destination migration has been separately approved/applied.
export const MUSICIAN_DISCOVERY_ENABLED = process.env.NEXT_PUBLIC_BANDUP_MUSICIAN_DISCOVERY_ENABLED === "true";
export const MUSICIAN_PAGE_SIZE = 20;
export type DiscoveredMusician = { name: string; available: boolean; avatarUrl: string | null };

export async function discoverMusicians(client: SupabaseClient, query: string, offset: number,
  signal: AbortSignal): Promise<{ musicians: DiscoveredMusician[]; hasNext: boolean }> {
  const name = query.trim();
  if (!MUSICIAN_DISCOVERY_ENABLED || signal.aborted || !name || [...query].length > 100
    || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Discovery unavailable");
  // One extra row determines continuation without exposing identities or counts.
  const { data, error } = await client.rpc("bandup_discover_musicians", {
    p_query: name, p_offset: offset, p_limit: MUSICIAN_PAGE_SIZE + 1,
  }).abortSignal(signal);
  if (signal.aborted || error || !Array.isArray(data) || data.length > MUSICIAN_PAGE_SIZE + 1) {
    throw new Error("Discovery unavailable");
  }
  const musicians = data.slice(0, MUSICIAN_PAGE_SIZE).map(row => {
    if (typeof row?.available !== "boolean") throw new Error("Invalid discovery response");
    return {
      name: normalizeMemberDisplayName(row?.display_name) ?? "Músico",
      available: row.available,
      avatarUrl: safeDiscoveryAvatar(row.photo_ref, row.available, process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
    };
  });
  return { musicians, hasNext: data.length > MUSICIAN_PAGE_SIZE };
}

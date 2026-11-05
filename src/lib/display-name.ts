import type { SupabaseClient } from "@supabase/supabase-js";

// Presentation data only. Never use names or user_metadata for authorization.
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!name || name.length > 80 || /[\p{Cc}\p{Cf}<>@]/u.test(name)) return null;
  return name;
}

export async function loadMemberNames(client: SupabaseClient, bandId: string, backendValidated = false): Promise<Map<string, string>> {
  // Future, band-scoped backend contract. Missing/denied RPC fails closed.
  // Never query Auth users or substitute emails.
  if (!backendValidated) return new Map();
  try {
    const { data, error } = await client.rpc("bandup_member_display_names", { p_band_id: bandId });
    const names = new Map<string, string>();
    if (error || !Array.isArray(data)) return names;
    for (const row of data) {
      const name = normalizeDisplayName(row?.display_name);
      if (typeof row?.user_id === "string" && name) names.set(row.user_id, name);
    }
    return names;
  } catch { return new Map(); }
}

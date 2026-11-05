import type { SupabaseClient } from "@supabase/supabase-js";

// Presentation data only. Never use names or user_metadata for authorization.
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!name || name.length > 80 || /[\p{Cc}\p{Cf}<>@]/u.test(name)) return null;
  return name;
}

// The validated RPC accepts Unicode/emoji, including joiners. Keep its display
// validation separate from account-name editing rules; never use it as identity.
export function normalizeMemberDisplayName(value: unknown): string | null {
  if (typeof value !== "string" || [...value].length > 80
    || /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069<>@]/u.test(value)) return null;
  const name = value.trim();
  if (!name || !name.replace(/[\s\u200b-\u200d\u2060\ufeff\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu, "")) return null;
  return name;
}

export async function loadMemberNames(client: SupabaseClient, bandId: string, backendValidated = false): Promise<Map<string, string>> {
  // Band-scoped RPC; opt in only at validated call sites. Missing/denied RPC fails closed.
  // Never query Auth users or substitute emails.
  if (!backendValidated) return new Map();
  try {
    const { data, error } = await client.rpc("bandup_member_display_names", { p_band_id: bandId });
    const names = new Map<string, string>();
    if (error || !Array.isArray(data)) return names;
    for (const row of data) {
      const name = normalizeMemberDisplayName(row?.display_name);
      if (typeof row?.user_id === "string" && name) names.set(row.user_id, name);
    }
    return names;
  } catch { return new Map(); }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeBandLogo } from "./public-band-data";

// Presentation only; membership authorization remains inside the RPC.
export async function loadMemberAvatars(
  client: SupabaseClient, bandId: string, userIds: string[],
): Promise<Map<string, string>> {
  const avatars = new Map<string, string>();
  const ids = [...new Set(userIds)];
  await Promise.all(Array.from({ length: Math.ceil(ids.length / 20) }, async (_, index) => {
    const batch = ids.slice(index * 20, (index + 1) * 20);
    try {
      const { data, error } = await client.rpc("bandup_member_avatars", {
        p_band_id: bandId, p_user_ids: batch,
      });
      if (error || !Array.isArray(data)) return;
      for (const row of data) {
        if (!batch.includes(row?.user_id) || typeof row?.avatar_url !== "string") continue;
        const url = safeBandLogo(row.avatar_url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local");
        // Keep the server's own-user/public-avatars contract at the display boundary too.
        if (url && new URL(url).pathname.startsWith(`/storage/v1/object/public/avatars/${row.user_id}/`)) {
          avatars.set(row.user_id, url);
        }
      }
    } catch { /* Photos are optional; other batches and member actions remain available. */ }
  }));
  return avatars;
}

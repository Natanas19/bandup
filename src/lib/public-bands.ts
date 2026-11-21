import "server-only";
import { PUBLIC_IDENTITY_ENABLED } from "@/lib/publication-control";

import { cache } from "react";
import { isValidPublicSlug, toPublicBand, toPublicBandLinks } from "@/lib/public-band-data";
import { readPublicBandLinkRows, readPublicBandRow } from "@/lib/supabase/public-server";

export type { PublicBand } from "@/lib/public-band-data";

// React cache only deduplicates within a server render; no persistent data cache.
export const getPublicBandBySlug = cache(async (slug: string) => {
  if (!PUBLIC_IDENTITY_ENABLED) return null;
  if (!isValidPublicSlug(slug)) return null;
  const { data, imageOrigin } = await readPublicBandRow(slug);
  return toPublicBand(data, slug, imageOrigin);
});

export async function getPublicBandLinks(slug: string) {
  if (!PUBLIC_IDENTITY_ENABLED || !isValidPublicSlug(slug)) return [];
  try {
    return toPublicBandLinks(await readPublicBandLinkRows(slug), slug);
  } catch {
    // Links are optional. Keep the published profile available if the view fails.
    return [];
  }
}

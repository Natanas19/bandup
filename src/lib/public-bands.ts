import "server-only";
import { PUBLIC_IDENTITY_ENABLED } from "@/lib/publication-control";

import { cache } from "react";
import { isValidPublicSlug, toPublicBand, toPublicBandLinks } from "@/lib/public-band-data";
import { readPublicBandEventRows, readPublicBandLinkRows, readPublicBandRow } from "@/lib/supabase/public-server";
import { toPublicBandEvents } from "@/lib/public-band-events";

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

export async function getPublicBandEvents(slug: string) {
  if (!PUBLIC_IDENTITY_ENABLED || !isValidPublicSlug(slug)) return [];
  try {
    return toPublicBandEvents(await readPublicBandEventRows(slug), slug);
  } catch {
    return [];
  }
}

export async function getPublishedBandProfile(slug: string) {
  const band = await getPublicBandBySlug(slug);
  if (!band) return null;
  const [links, events] = await Promise.all([getPublicBandLinks(band.slug), getPublicBandEvents(band.slug)]);
  return { band, links, events };
}

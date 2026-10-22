import "server-only";

import { cache } from "react";
import { isValidPublicSlug, toPublicBand } from "@/lib/public-band-data";
import { readPublicBandRow } from "@/lib/supabase/public-server";

export type { PublicBand } from "@/lib/public-band-data";

// React cache only deduplicates within a server render; no persistent data cache.
export const getPublicBandBySlug = cache(async (slug: string) => {
  if (!isValidPublicSlug(slug)) return null;
  const { data, imageOrigin } = await readPublicBandRow(slug);
  return toPublicBand(data, slug, imageOrigin);
});

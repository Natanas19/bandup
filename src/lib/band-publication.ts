"use client";

import { requirePublicationEnabled } from "@/lib/publication-control";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isValidPublicSlug } from "@/lib/public-band-data";
import { getSafeExternalUrl } from "@/lib/social-links";

export class BandPublicationError extends Error {}

export function getPublicProfilePath(slug: string | null | undefined): string | null {
  if (typeof slug !== "string" || !isValidPublicSlug(slug) || slug === "." || slug === "..") return null;
  try {
    return `/b/${encodeURIComponent(slug)}`;
  } catch {
    return null;
  }
}

export async function verifyBandAdmin(bandId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: membership, error: membershipError } = await supabase
    .from("band_members")
    .select("role")
    .eq("band_id", bandId)
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (membershipError || membership?.role !== "admin") return null;
  return { supabase, user: data.user };
}

const unconfirmed = () => new BandPublicationError(
  "Não foi possível confirmar o salvamento. Recarregue a página para conferir o estado atual antes de tentar novamente.",
);

export async function updateBandPublication(bandId: string, isPublic: boolean) {
  requirePublicationEnabled();
  const access = await verifyBandAdmin(bandId);
  if (!access) throw new BandPublicationError("Somente administradores da banda podem alterar o perfil público.");

  const { data: current, error: currentError } = await access.supabase
    .from("bands").select("id, slug, is_public").eq("id", bandId).maybeSingle();
  if (currentError || !current || typeof current.is_public !== "boolean") throw unconfirmed();
  if (isPublic && !getPublicProfilePath(current.slug)) {
    throw new BandPublicationError("A banda precisa de um endereço válido antes de ativar o perfil público.");
  }

  if (isPublic) {
    // Legacy selected links must be repaired or hidden before re-publication.
    const { data: selected, error: linksError } = await access.supabase
      .from("social_links").select("url").eq("band_id", bandId).eq("is_public", true);
    if (linksError || !Array.isArray(selected)) throw unconfirmed();
    if (selected.some((link) => !getSafeExternalUrl(link.url))) {
      throw new BandPublicationError("Corrija ou oculte os links com URL insegura antes de ativar o perfil p\u00fablico.");
    }
  }

  const { data: updated, error } = await access.supabase
    .from("bands")
    .update({ is_public: isPublic })
    .eq("id", bandId)
    .eq("is_public", current.is_public)
    .select("id, is_public")
    .maybeSingle();

  if (error || !updated || updated.id !== bandId || updated.is_public !== isPublic) throw unconfirmed();

  const { data: confirmed, error: confirmationError } = await access.supabase
    .from("bands").select("id, slug, is_public").eq("id", bandId).maybeSingle();
  if (confirmationError || !confirmed || confirmed.id !== bandId || confirmed.is_public !== isPublic) throw unconfirmed();
  return confirmed as { id: string; slug: string | null; is_public: boolean };
}

export async function updateLinkPublication(
  bandId: string,
  linkId: string,
  previousValue: boolean,
  isPublic: boolean,
) {
  requirePublicationEnabled();
  const access = await verifyBandAdmin(bandId);
  if (!access) throw new BandPublicationError("Somente administradores da banda podem alterar a visibilidade dos links.");

  if (isPublic) {
    const { data: band, error } = await access.supabase
      .from("bands").select("slug").eq("id", bandId).maybeSingle();
    if (error || !band) throw unconfirmed();
    if (!getPublicProfilePath(band.slug)) {
      throw new BandPublicationError("A banda precisa de um endereço válido para selecionar links públicos.");
    }
  }

  let publishUrl: string | null = null;
  if (isPublic) {
    // Validate the stored row, not a potentially stale value supplied by the UI.
    const { data: current, error: currentError } = await access.supabase
      .from("social_links").select("url").eq("id", linkId).eq("band_id", bandId).maybeSingle();
    if (currentError || !current) throw unconfirmed();
    if (!getSafeExternalUrl(current.url)) {
      throw new BandPublicationError("Corrija a URL insegura antes de publicar este link.");
    }
    publishUrl = current.url;
  }

  let update = access.supabase
    .from("social_links")
    .update({ is_public: isPublic })
    .eq("id", linkId)
    .eq("band_id", bandId)
    .eq("is_public", previousValue);
  // If the URL changed since validation, fail instead of publishing another URL.
  if (publishUrl !== null) update = update.eq("url", publishUrl);
  const { data: updated, error } = await update.select("id, band_id, is_public").maybeSingle();

  if (error || !updated || updated.id !== linkId || updated.band_id !== bandId || updated.is_public !== isPublic) throw unconfirmed();

  const { data: confirmed, error: confirmationError } = await access.supabase
    .from("social_links").select("id, band_id, is_public")
    .eq("id", linkId).eq("band_id", bandId).maybeSingle();
  if (confirmationError || !confirmed || confirmed.id !== linkId || confirmed.band_id !== bandId || confirmed.is_public !== isPublic) throw unconfirmed();
  return confirmed as { id: string; band_id: string; is_public: boolean };
}
import { getBandPublicLinkUrl, isValidPublicLinkLabel, PUBLIC_LINK_LIMIT, type PublicLinkPlatform } from "@/lib/public-link-url";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export { getBandPublicLinkUrl, PUBLIC_LINK_LIMIT, PUBLIC_LINK_URL_LIMIT, publicLinkPlatforms, type PublicLinkPlatform } from "@/lib/public-link-url";
export type PublicLinkInput = { platform: PublicLinkPlatform; url: string; label: string | null };
export type BandPublicLink = PublicLinkInput & { id: string; position: number };
const linkColumns = "id, platform, label, url, position";

export function validateBandPublicLink(input: PublicLinkInput): PublicLinkInput {
  const url = getBandPublicLinkUrl(input.url, input.platform);
  if (!url) {
    throw new BandPublicLinksError("Informe uma URL HTTPS válida, de até 2.048 caracteres, com um domínio permitido para a plataforma.", false);
  }
  const label = input.label?.trim() || null;
  if (input.label && !isValidPublicLinkLabel(input.label)) {
    throw new BandPublicLinksError("O rótulo deve ter até 80 caracteres e uma única linha.", false);
  }
  return { platform: input.platform, label, url };
}

export class BandPublicLinksError extends Error {
  constructor(message: string, readonly refreshList = true) {
    super(message);
  }
}

export async function listBandPublicLinks(bandId: string, signal: AbortSignal) {
  const { data, error } = await getSupabaseBrowserClient().from("band_public_links").select(linkColumns)
    .eq("band_id", bandId).order("position").abortSignal(signal);
  if (error || !data) throw new BandPublicLinksError("Não foi possível carregar os links públicos.");
  return data as BandPublicLink[];
}

export async function saveBandPublicLink(bandId: string, input: PublicLinkInput, links: BandPublicLink[], id?: string) {
  const values = validateBandPublicLink(input);
  const table = getSupabaseBrowserClient().from("band_public_links");
  if (id) {
    const { data, error } = await table.update(values).eq("band_id", bandId).eq("id", id).select("id").maybeSingle();
    if (error || !data) throw new BandPublicLinksError("Não foi possível confirmar a edição. Confira a lista e seu acesso.");
    return;
  }

  const usedPositions = new Set(links.map(link => link.position));
  const nextPosition = Math.max(0, ...usedPositions) + 1;
  const position = nextPosition <= PUBLIC_LINK_LIMIT ? nextPosition :
    Array.from({ length: PUBLIC_LINK_LIMIT }, (_, index) => index + 1).find(slot => !usedPositions.has(slot));
  if (links.length >= PUBLIC_LINK_LIMIT || position === undefined) {
    throw new BandPublicLinksError("A banda já atingiu o limite de 8 links públicos.", false);
  }

  const { data, error } = await table.insert({ ...values, band_id: bandId, position }).select("id").single();
  if (error?.code === "23505") {
    throw new BandPublicLinksError("A posição foi ocupada em outra sessão. Confira a lista atualizada antes de tentar novamente.");
  }
  if (error || !data) throw new BandPublicLinksError("Não foi possível confirmar a inclusão. Confira a lista antes de tentar novamente.");
}

export async function deleteBandPublicLink(bandId: string, id: string) {
  const { data, error } = await getSupabaseBrowserClient().from("band_public_links").delete()
    .eq("band_id", bandId).eq("id", id).select("id").maybeSingle();
  if (error || !data) throw new BandPublicLinksError("Não foi possível confirmar a exclusão. Confira a lista e seu acesso.");
}

export async function swapBandPublicLinkPositions(bandId: string, first: BandPublicLink, second: BandPublicLink) {
  const { error } = await getSupabaseBrowserClient().rpc("bandup_swap_public_link_positions", {
    p_band_id: bandId,
    p_first_id: first.id,
    p_first_position: first.position,
    p_second_id: second.id,
    p_second_position: second.position,
  });
  if (error?.code === "PT409") {
    throw new BandPublicLinksError("A ordem ou a lista mudou. Confira os links atualizados antes de tentar novamente.");
  }
  if (error) throw new BandPublicLinksError("Não foi possível confirmar a nova ordem. Confira a lista e seu acesso.");
}

// Build-time opt-in only. Keep unset/false until the public DB contract is approved.
// This application guard does not replace database RLS or change existing views.
export const PUBLICATION_ENABLED = process.env.NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED === "true";

export const PUBLICATION_UNAVAILABLE_MESSAGE = "Publicação pública temporariamente indisponível. A navegação privada continua disponível.";
export const LINK_WRITES_UNAVAILABLE_MESSAGE = "Adicionar, editar, excluir e publicar links está temporariamente indisponível. Esta pausa não altera a visibilidade já existente dos links.";

export class PublicationDisabledError extends Error {
  constructor() { super(PUBLICATION_UNAVAILABLE_MESSAGE); this.name = "PublicationDisabledError"; }
}

export function requirePublicationEnabled(): void {
  if (!PUBLICATION_ENABLED) throw new PublicationDisabledError();
}

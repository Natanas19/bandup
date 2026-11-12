import type { BandEntryService, DiscoveredBand } from "@/lib/band-entry";
import { normalizeDisplayName } from "@/lib/display-name";

const comparable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
export function defaultEntryMessage(name: string) {
  return `Olá! Me chamo ${name} e gostaria de participar da sua banda.`;
}

// Search RPC exposes band IDs, names and optional public logos, with a UUID cursor.
// Search registered bands after explicit input; bound each batch and allow continuation.
export async function searchBandNames(api: Pick<BandEntryService, "discover">, query: string, after: string | null = null) {
  const term = comparable(query.trim());
  if (!term || query.length > 100) throw new Error("Informe um nome ou ID de banda de até 100 caracteres.");
  const matches: DiscoveredBand[] = [];
  let cursor = after;
  for (let page = 0; page < 5; page++) {
    const rows = await api.discover(cursor);
    matches.push(...rows.filter(row => comparable(row.name).includes(term) || row.band_id.toLowerCase() === term));
    if (rows.length < 20) return { matches, next: null };
    const next = rows[rows.length - 1].band_id;
    if (!next || next === cursor) throw new Error("Invalid directory cursor");
    cursor = next;
  }
  return { matches, next: cursor };
}

export async function registerEntryRequest(api: Pick<BandEntryService, "pendingRequest" | "request" | "getRequest">, bandId: string, name: string) {
  const normalized = normalizeDisplayName(name);
  if (!normalized) throw new Error("Nome de exibição inválido");
  if (await api.pendingRequest(bandId)) return "pending" as const;
  let id: string;
  try { id = await api.request(bandId, normalized); }
  catch (error) {
    // Duplicate or lost write response: confirm actual persistence, never retry a write.
    if (await api.pendingRequest(bandId)) return "pending" as const;
    throw error;
  }
  const row = await api.getRequest(id);
  if (!row || row.id !== id || row.band_id !== bandId || !["pending", "approved"].includes(row.status)) throw new Error("Unconfirmed request");
  return "created" as const;
}

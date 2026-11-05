import type { SupabaseClient } from "@supabase/supabase-js";

// Temporary opt-in for manual demo testing, never a production release.
// Direct env references are required for Next.js browser bundle substitution.
// RPCs/RLS remain the authorization boundary.
export const BAND_ENTRY_BACKEND_VALIDATED = typeof process !== "undefined"
  && process.env.NODE_ENV === "development"
  && process.env.NEXT_PUBLIC_BAND_ENTRY_DEMO_TEST === "1"
  // The browser client accepts the project root or its configured REST endpoint.
  // Anchor the entire value so paths cannot disguise a different origin.
  && /^https:\/\/zwmihhdvvpqgyavworgh\.supabase\.co(?:\/rest\/v1)?\/?$/.test(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

function isLocalBrowser() {
  return typeof window !== "undefined"
    && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}
export type EntryStatus = "pending" | "approved" | "rejected" | "cancelled";
export type DiscoveredBand = { band_id: string; display_name: string; summary: string };
export type DiscoverySettings = DiscoveredBand & { accepting_requests: boolean };
export type EntryRequest = {
  id: string; band_id: string; requester_id: string; applicant_name: string;
  status: EntryStatus; requested_at: string; decided_at: string | null;
  decided_by: string | null; cancelled_at: string | null;
};
export class BandEntryError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export function entryError(error: unknown): BandEntryError {
  if (error instanceof BandEntryError) return error;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  const messages: Record<string, string> = {
    blocked: "Funcionalidade indisponível enquanto o backend não for validado.",
    "42501": "Você não tem permissão ou a banda não está disponível. Atualize os dados.",
    "23505": "Já existe um pedido pendente ou você já integra a banda. Atualize os dados.",
    "55000": "Este pedido já foi decidido ou cancelado. Atualize os dados.",
    "22023": "Confira os campos informados e tente novamente.",
    "23514": "Os dados não atendem às regras da banda.",
  };
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(code))
    return new BandEntryError("blocked", messages.blocked);
  return new BandEntryError(code, messages[code] ?? "Não foi possível confirmar o resultado. Atualize os dados antes de tentar novamente.");
}

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const requireId = (value: string) => { if (!uuid(value)) throw entryError({ code: "22023" }); };
const fields = "id,band_id,requester_id,applicant_name,status,requested_at,decided_at,decided_by,cancelled_at";
const pageSize = 20;

// Never derive validation from table/RPC existence or caller-supplied flags.
export function createBandEntryService(client: SupabaseClient) {
  async function actor(bandId?: string) {
    if (!BAND_ENTRY_BACKEND_VALIDATED || !isLocalBrowser())
      throw entryError({ code: "blocked" });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw entryError({ code: "42501" });
    if (bandId) {
      requireId(bandId);
      const result = await client.from("band_members").select("role")
        .eq("band_id", bandId).eq("user_id", data.user.id).maybeSingle();
      if (result.error || result.data?.role !== "admin") throw entryError({ code: "42501" });
    }
    return data.user.id;
  }
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw entryError(error);
    return data as T;
  }
  async function requests(bandId: string | undefined, offset: number) {
    const userId = await actor(bandId);
    if (!Number.isInteger(offset) || offset < 0) throw entryError({ code: "22023" });
    const result = await client.from("band_join_requests").select(fields)
      .eq(bandId ? "band_id" : "requester_id", bandId ?? userId)
      .order("requested_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (result.error) throw entryError(result.error);
    return (result.data ?? []) as EntryRequest[];
  }
  async function ownPending(id: string) {
    requireId(id);
    const userId = await actor();
    const result = await client.from("band_join_requests").select("id,status")
      .eq("id", id).eq("requester_id", userId).maybeSingle();
    if (result.error) throw entryError(result.error);
    if (!result.data) throw entryError({ code: "42501" });
    if (result.data.status !== "pending") throw entryError({ code: "55000" });
  }
  return {
    async discover(after: string | null = null): Promise<DiscoveredBand[]> {
      await actor();
      if (after) requireId(after);
      return rpc("bandup_discover_bands", { p_after: after, p_limit: pageSize });
    },
    ownRequests: (offset = 0) => requests(undefined, offset),
    async pendingRequest(bandId: string): Promise<EntryRequest | null> {
      requireId(bandId);
      const userId = await actor();
      const result = await client.from("band_join_requests").select(fields)
        .eq("requester_id", userId).eq("band_id", bandId).eq("status", "pending").maybeSingle();
      if (result.error) throw entryError(result.error);
      return result.data as EntryRequest | null;
    },
    adminRequests: (bandId: string, offset = 0) => requests(bandId, offset),
    async getRequest(id: string, bandId?: string): Promise<EntryRequest | null> {
      requireId(id);
      const userId = await actor(bandId);
      const result = await client.from("band_join_requests").select(fields).eq("id", id)
        .eq(bandId ? "band_id" : "requester_id", bandId ?? userId).maybeSingle();
      if (result.error) throw entryError(result.error);
      return result.data as EntryRequest | null;
    },
    async getDiscovery(bandId: string): Promise<DiscoverySettings | null> {
      await actor(bandId);
      const rows = await rpc<DiscoverySettings[]>("bandup_get_discovery", { p_band_id: bandId });
      return rows[0] ?? null;
    },
    async setDiscovery(settings: DiscoverySettings): Promise<void> {
      await actor(settings.band_id);
      if (!settings.display_name.trim() || [...settings.display_name.trim()].length > 100 || [...settings.summary].length > 500
        || typeof settings.accepting_requests !== "boolean") throw entryError({ code: "22023" });
      await rpc("bandup_set_discovery", { p_band_id: settings.band_id, p_display_name: settings.display_name.trim(),
        p_summary: settings.summary, p_accepting: settings.accepting_requests });
    },
    async request(bandId: string, applicantName: string): Promise<string> {
      await actor(); requireId(bandId);
      if (!applicantName.trim() || [...applicantName.trim()].length > 80) throw entryError({ code: "22023" });
      const id = await rpc<string>("bandup_request_entry", { p_band_id: bandId, p_applicant_name: applicantName.trim() });
      if (!id || !uuid(id)) throw entryError(null);
      return id;
    },
    async cancel(id: string): Promise<void> {
      await ownPending(id);
      await rpc("bandup_cancel_entry", { p_request_id: id });
    },
    async decide(bandId: string, id: string, decision: "approved" | "rejected"): Promise<void> {
      requireId(id); await actor(bandId);
      if (!["approved", "rejected"].includes(decision)) throw entryError({ code: "22023" });
      const result = await client.from("band_join_requests").select("id,status")
        .eq("id", id).eq("band_id", bandId).maybeSingle();
      if (result.error) throw entryError(result.error);
      if (!result.data) throw entryError({ code: "42501" });
      if (result.data.status !== "pending") throw entryError({ code: "55000" });
      await rpc("bandup_decide_entry", { p_request_id: id, p_decision: decision });
    },
  };
}
export type BandEntryService = ReturnType<typeof createBandEntryService>;

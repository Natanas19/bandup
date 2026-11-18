import type { SupabaseClient } from "@supabase/supabase-js";

// Direct env references are required for Next.js browser bundle substitution.
// Presence enables the configured feature; Auth, RLS and RPCs remain the
// authorization boundary. This flag does not claim that a live backend passed
// a connectivity or permission check.
function hasSupabaseConfiguration() {
  if (typeof process === "undefined" || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return false;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return url.protocol === "https:" && !url.username && !url.password
      && !url.search && !url.hash
      && ["", "/", "/rest/v1", "/rest/v1/"].includes(url.pathname);
  } catch {
    return false;
  }
}
export const BAND_ENTRY_BACKEND_VALIDATED = hasSupabaseConfiguration();
export type EntryStatus = "pending" | "approved" | "rejected" | "cancelled" | "superseded";
export type DiscoveredBand = { band_id: string; name: string; logo_url: string | null };
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
    if (!BAND_ENTRY_BACKEND_VALIDATED)
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
  async function requests(bandId: string | undefined, offset: number, pendingOnly = false) {
    const userId = await actor(bandId);
    if (!Number.isInteger(offset) || offset < 0) throw entryError({ code: "22023" });
    const query = client.from("band_join_requests").select(fields)
      .eq(bandId ? "band_id" : "requester_id", bandId ?? userId);
    if (pendingOnly) query.eq("status", "pending");
    const result = await query.order("requested_at", { ascending: false }).order("id", { ascending: false })
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
      const rows = await rpc<unknown>("bandup_discover_bands_v2", { p_after: after, p_limit: pageSize });
      if (!Array.isArray(rows) || rows.some(row => !row || !uuid(row.band_id) || typeof row.display_name !== "string")) throw entryError(null);
      // Keep the public search contract narrow even if a server returns extra fields.
      return rows.map(row => ({ band_id: row.band_id, name: row.display_name,
        logo_url: typeof row.logo_url === "string" ? row.logo_url : null }));
    },
    ownRequests: (offset = 0) => requests(undefined, offset, true),
    async pendingRequest(bandId: string): Promise<EntryRequest | null> {
      requireId(bandId);
      const userId = await actor();
      const result = await client.from("band_join_requests").select(fields)
        .eq("requester_id", userId).eq("band_id", bandId).eq("status", "pending").maybeSingle();
      if (result.error) throw entryError(result.error);
      return result.data as EntryRequest | null;
    },
    async entryEligibility(bandId: string): Promise<"member" | "pending" | "eligible"> {
      requireId(bandId);
      const userId = await actor();
      const [membership, request] = await Promise.all([
        client.from("band_members").select("user_id")
          .eq("band_id", bandId).eq("user_id", userId).maybeSingle(),
        client.from("band_join_requests").select("id")
          .eq("requester_id", userId).eq("band_id", bandId).eq("status", "pending").maybeSingle(),
      ]);
      if (membership.error) throw entryError(membership.error);
      if (request.error) throw entryError(request.error);
      if (membership.data) return "member";
      if (request.data) return "pending";
      return "eligible";
    },
    adminRequests: (bandId: string, offset = 0, pendingOnly = false) => requests(bandId, offset, pendingOnly),
    async pendingRequestAvatars(bandId: string, requestIds: string[]): Promise<Map<string, string | null>> {
      if (requestIds.length > pageSize) throw entryError({ code: "22023" });
      requestIds.forEach(requireId);
      const ids = [...new Set(requestIds)];
      const avatars = new Map<string, string | null>();
      if (!ids.length) return avatars;
      await actor(bandId);
      const rows = await rpc<unknown>("bandup_pending_request_avatars", { p_band_id: bandId, p_request_ids: ids });
      if (!Array.isArray(rows)) throw entryError(null);
      for (const row of rows) {
        if (!row || typeof row.request_id !== "string" || !ids.includes(row.request_id)) continue;
        avatars.set(row.request_id, typeof row.avatar_url === "string" ? row.avatar_url : null);
      }
      return avatars;
    },
    async getRequest(id: string, bandId?: string): Promise<EntryRequest | null> {
      requireId(id);
      const userId = await actor(bandId);
      const result = await client.from("band_join_requests").select(fields).eq("id", id)
        .eq(bandId ? "band_id" : "requester_id", bandId ?? userId).maybeSingle();
      if (result.error) throw entryError(result.error);
      return result.data as EntryRequest | null;
    },
    async request(bandId: string, applicantName: string): Promise<string> {
      const userId = await actor(); requireId(bandId);
      if (!applicantName.trim() || [...applicantName.trim()].length > 80) throw entryError({ code: "22023" });
      const membership = await client.from("band_members").select("user_id")
        .eq("band_id", bandId).eq("user_id", userId).maybeSingle();
      if (membership.error) throw entryError(membership.error);
      if (membership.data) throw entryError({ code: "23505" });
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

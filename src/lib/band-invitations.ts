import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMemberDisplayName } from "./display-name";
import { safeDiscoveryAvatar } from "./public-band-data";

export const INVITATION_PAGE_SIZE = 20;
export type InvitationStatus = "pending" | "accepted" | "rejected" | "superseded";
export type InvitationDecision = "accepted" | "rejected";
export type BandInvitation = {
  invitation_id: string; band_id: string; band_name: string; musician_ref: string;
  status: InvitationStatus; created_at: string; decided_at: string | null;
};
export type InvitationMusician = { name: string; available: boolean; musicianRef: string | null; avatarUrl: string | null };
export type InvitationBand = { id: string; name: string };
export const invitationStatusLabel: Record<InvitationStatus, string> = {
  pending: "Pendente", accepted: "Aceito", rejected: "Recusado", superseded: "Encerrado pela entrada na banda",
};
export class InvitationError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export function invitationError(error: unknown): InvitationError {
  if (error instanceof InvitationError) return error;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  const messages: Record<string, string> = {
    blocked: "Convites ainda não estão disponíveis.",
    "42501": "Você não tem permissão ou o convite não está disponível. Atualize os dados.",
    "23505": "Já existe um convite pendente ou o músico já integra a banda. Atualize os convites enviados.",
    "55000": "Este convite já foi encerrado. Atualize a lista.",
    "55P03": "Há outra operação em andamento. Atualize os dados antes de tentar novamente.",
    "25001": "Não foi possível concluir nesta sessão. Atualize os dados e tente novamente mais tarde.",
    "54000": "Limite de convites atingido. Aguarde antes de enviar outro convite.",
    "22023": "Confira a banda e o músico selecionados.",
  };
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(code)) return new InvitationError("blocked", messages.blocked);
  return new InvitationError(code, messages[code] ?? "Não foi possível confirmar o resultado. Atualize os convites antes de tentar novamente.");
}
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
function id(value: unknown) { if (!uuid(value)) throw invitationError({ code: "22023" }); }

export function createBandInvitationService(client: SupabaseClient) {
  async function rpc(name: string, args: Record<string, unknown>) {
    try {
      const { data, error } = await client.rpc(name, args);
      if (error) throw invitationError(error);
      return data;
    } catch (error) { throw invitationError(error); }
  }
  return {
    async adminBands(): Promise<InvitationBand[]> {
      const { data: account, error } = await client.auth.getUser();
      if (error || !account.user) throw invitationError({ code: "42501" });
      const result = await client.from("band_members").select("band:bands!inner(id,name)")
        .eq("user_id", account.user.id).eq("role", "admin");
      if (result.error) throw invitationError(result.error);
      return ((result.data ?? []) as unknown as { band: InvitationBand | null }[])
        .flatMap(row => row.band && uuid(row.band.id) && typeof row.band.name === "string"
          ? [{ id: row.band.id, name: row.band.name }] : []);
    },
    async discover(query: string, offset = 0): Promise<{ musicians: InvitationMusician[]; hasNext: boolean }> {
      const name = query.trim();
      if (!name || [...query].length > 100 || !Number.isSafeInteger(offset) || offset < 0) throw invitationError({ code: "22023" });
      const data = await rpc("bandup_discover_musicians_for_invites", { p_query: name, p_offset: offset, p_limit: INVITATION_PAGE_SIZE + 1 });
      if (!Array.isArray(data) || data.length > INVITATION_PAGE_SIZE + 1) throw invitationError(null);
      const musicians = data.slice(0, INVITATION_PAGE_SIZE).map(row => {
        if (typeof row?.available !== "boolean" || (row.musician_ref !== null && !uuid(row.musician_ref))
          || (!row.available && row.musician_ref !== null)) throw invitationError(null);
        return {
          name: normalizeMemberDisplayName(row.display_name) ?? "Músico",
          available: row.available,
          musicianRef: row.musician_ref,
          avatarUrl: safeDiscoveryAvatar(row.photo_ref, row.available, process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
        };
      });
      return { musicians, hasNext: data.length > INVITATION_PAGE_SIZE };
    },
    async send(bandId: string, musicianRef: string): Promise<string> {
      id(bandId); id(musicianRef);
      const data = await rpc("bandup_invite_musician", { p_band_id: bandId, p_musician_ref: musicianRef });
      if (!uuid(data)) throw invitationError(null);
      return data;
    },
    async decide(invitationId: string, decision: InvitationDecision): Promise<InvitationDecision> {
      id(invitationId);
      if (!["accepted", "rejected"].includes(decision)) throw invitationError({ code: "22023" });
      const data = await rpc("bandup_decide_invitation", { p_invitation_id: invitationId, p_decision: decision });
      if (data !== decision) throw invitationError(null);
      return data;
    },
    async list(bandId: string | null = null, offset = 0): Promise<BandInvitation[]> {
      if (bandId !== null) id(bandId);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw invitationError({ code: "22023" });
      const data = await rpc("bandup_list_invitations", { p_band_id: bandId, p_offset: offset, p_limit: INVITATION_PAGE_SIZE });
      if (!Array.isArray(data) || data.length > INVITATION_PAGE_SIZE) throw invitationError(null);
      return data.map(row => {
        if (!uuid(row?.invitation_id) || !uuid(row.band_id) || !uuid(row.musician_ref) || typeof row.band_name !== "string"
          || !Object.hasOwn(invitationStatusLabel, row.status) || !timestamp(row.created_at)
          || (row.status === "pending" ? row.decided_at !== null : !timestamp(row.decided_at))
          || (bandId !== null && row.band_id !== bandId)) throw invitationError(null);
        return { invitation_id: row.invitation_id, band_id: row.band_id, band_name: row.band_name, musician_ref: row.musician_ref,
          status: row.status, created_at: row.created_at, decided_at: row.decided_at };
      });
    },
  };
}

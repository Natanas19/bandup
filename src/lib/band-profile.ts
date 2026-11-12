import type { SupabaseClient } from "@supabase/supabase-js";
import { bandPhotoSession } from "./band-logo-upload";
import { requiredTextError } from "./form-validation";

export type BandProfile = { id: string; name: string; description: string | null; logo_url: string | null };
export type BandProfileAccess = { band: BandProfile; role: "admin" | "member" };
export class BandProfileError extends Error {
  constructor(readonly code: "access" | "validation" | "unconfirmed") {
    super(code === "access" ? "Seu acesso ou sua permissão mudou. Atualize a página."
      : code === "validation" ? "Informe um nome de até 100 caracteres e uma descrição de até 500 caracteres."
      : "Não foi possível confirmar o salvamento. Alguns dados podem ter sido salvos; confira antes de tentar novamente.");
  }
}
const columns = "id,name,description,logo_url";

async function membership(scoped: SupabaseClient, userId: string, bandId: string, adminOnly = false) {
  const result = await scoped.from("band_members").select("role").eq("band_id", bandId).eq("user_id", userId).maybeSingle();
  const role = result.data?.role;
  if (result.error || (role !== "admin" && role !== "member") || (adminOnly && role !== "admin")) throw new BandProfileError("access");
  return role as "admin" | "member";
}

export async function loadBandProfile(client: SupabaseClient, userId: string, bandId: string,
  signal: AbortSignal): Promise<BandProfileAccess> {
  const { scoped, verify } = await bandPhotoSession(client, userId, signal);
  await membership(scoped, userId, bandId);
  const result = await scoped.from("bands").select(columns).eq("id", bandId).maybeSingle();
  await verify();
  const role = await membership(scoped, userId, bandId);
  await verify();
  if (result.error || !result.data || result.data.id !== bandId) throw new BandProfileError("access");
  if (signal.aborted) throw new BandProfileError("access");
  return { band: result.data as BandProfile, role };
}

export async function saveBandProfile(client: SupabaseClient, userId: string, bandId: string,
  name: string, description: string, signal: AbortSignal): Promise<BandProfileAccess> {
  const values = { name: name.trim(), description: description.trim() || null };
  if (requiredTextError(values.name, "o nome da banda") || values.name.length > 100 || description.length > 500) throw new BandProfileError("validation");
  const { scoped, verify } = await bandPhotoSession(client, userId, signal);
  await membership(scoped, userId, bandId, true);
  await verify();
  if (signal.aborted) throw new BandProfileError("access");
  // RLS is authoritative. The captured JWT and band ID cannot follow another
  // account/route. Never send logo_url, slug, role or caller-controlled identity.
  let denied = false;
  try {
    const result = await scoped.from("bands").update(values).eq("id", bandId).select("id").maybeSingle();
    denied = result.error?.code === "42501" || (!result.error && !result.data);
  } catch { /* A lost response may have committed. Confirm with a private read. */ }
  await verify();
  await membership(scoped, userId, bandId, true);
  if (denied) throw new BandProfileError("access");
  const result = await scoped.from("bands").select(columns).eq("id", bandId).maybeSingle();
  await verify();
  await membership(scoped, userId, bandId, true);
  await verify();
  if (signal.aborted) throw new BandProfileError("access");
  if (result.error || !result.data || result.data.id !== bandId
    || result.data.name !== values.name || result.data.description !== values.description) throw new BandProfileError("unconfirmed");
  return { band: result.data as BandProfile, role: "admin" };
}

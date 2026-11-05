import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDisplayName } from "@/lib/display-name";

export type PersonalBand = { role: string; band: { id: string; name: string } };
export type PersonalOverview = { name: string | null; emailConfirmed: boolean; bands: PersonalBand[] };

export async function loadPersonalOverview(client: SupabaseClient): Promise<PersonalOverview> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Não foi possível verificar sua conta. Acesse o login ou tente novamente.");
  const result = await client.from("band_members")
    .select("role, band:bands!inner(id, name)").eq("user_id", data.user.id);
  if (result.error) throw new Error("Não foi possível carregar seu perfil e suas bandas. Tente novamente.");
  const bands = ((result.data ?? []) as unknown as (PersonalBand | { role: string; band: null })[])
    .filter((row): row is PersonalBand => !!row.band);
  return {
    name: normalizeDisplayName(data.user.user_metadata?.display_name),
    emailConfirmed: !!data.user.email_confirmed_at,
    bands,
  };
}

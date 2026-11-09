import type { SupabaseClient } from "@supabase/supabase-js";

export const PERSONAL_AGENDA_MEMBERSHIP_PAGE_SIZE = 200;
export const PERSONAL_AGENDA_EVENT_PAGE_SIZE = 500;

export class PersonalAgendaLoadError extends Error {}

export type PersonalEvent = {
  id: string;
  band_id: string;
  bandName: string;
  title: string;
  description: string | null;
  event_type: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
};

type Membership = { band_id: string; role: string; band: { id: string; name: string } | null };
type EventRow = Omit<PersonalEvent, "bandName">;

// Session-client filters complement database RLS and never replace it.
export async function loadPersonalAgenda(client: SupabaseClient): Promise<PersonalEvent[]> {
  const { data: account, error: authError } = await client.auth.getUser();
  if (authError || !account.user) {
    throw new PersonalAgendaLoadError("Não foi possível verificar sua conta. Entre novamente ou tente atualizar.");
  }

  const bands = new Map<string, string>();
  for (let start = 0; ; start += PERSONAL_AGENDA_MEMBERSHIP_PAGE_SIZE) {
    const { data, error } = await client.from("band_members")
      .select("band_id, role, band:bands!inner(id, name)")
      .eq("user_id", account.user.id)
      .order("band_id", { ascending: true })
      .range(start, start + PERSONAL_AGENDA_MEMBERSHIP_PAGE_SIZE - 1);
    if (error) {
      throw new PersonalAgendaLoadError("Não foi possível verificar suas bandas e permissões. Tente novamente.");
    }
    const memberships = (data ?? []) as unknown as Membership[];
    for (const membership of memberships) {
      if ((membership.role === "admin" || membership.role === "member")
        && membership.band?.id === membership.band_id && membership.band.name.trim()) {
        bands.set(membership.band_id, membership.band.name);
      }
    }
    if (memberships.length < PERSONAL_AGENDA_MEMBERSHIP_PAGE_SIZE) break;
  }

  if (!bands.size) return [];

  const events: PersonalEvent[] = [];
  for (let start = 0; ; start += PERSONAL_AGENDA_EVENT_PAGE_SIZE) {
    const { data, error } = await client.from("events")
      .select("id, band_id, title, description, event_type, start_at, end_at, location")
      .in("band_id", [...bands.keys()])
      .order("start_at", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + PERSONAL_AGENDA_EVENT_PAGE_SIZE - 1);
    if (error) {
      throw new PersonalAgendaLoadError("Não foi possível carregar sua agenda. Seu acesso pode ter mudado. Tente novamente.");
    }

    const rows = (data ?? []) as unknown as EventRow[];
    if (rows.some(row => !bands.has(row.band_id) || !row.id || !row.title || !row.start_at)) {
      throw new PersonalAgendaLoadError("Não foi possível confirmar o acesso aos eventos retornados. Atualize a página.");
    }
    events.push(...rows.map(row => ({ ...row, bandName: bands.get(row.band_id)! })));
    if (rows.length < PERSONAL_AGENDA_EVENT_PAGE_SIZE) break;
  }

  return events;
}

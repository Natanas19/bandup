export type PublicBandEvent = {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
};

export function toPublicBandEvents(rows: unknown, slug: string): PublicBandEvent[] {
  if (!Array.isArray(rows)) return [];
  const events: PublicBandEvent[] = [];
  for (const row of rows) {
    if (!row || row.slug !== slug || typeof row.id !== "string"
      || typeof row.title !== "string" || !row.title.trim()
      || typeof row.start_at !== "string" || !Number.isFinite(Date.parse(row.start_at))
      || (row.end_at !== null && (typeof row.end_at !== "string" || !Number.isFinite(Date.parse(row.end_at))
        || Date.parse(row.end_at) < Date.parse(row.start_at)))) continue;
    events.push({ id: row.id, title: row.title, start_at: row.start_at, end_at: row.end_at });
  }
  return events.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || a.id.localeCompare(b.id));
}

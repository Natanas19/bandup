import type { SupabaseClient } from "@supabase/supabase-js";

export type BandCreationAttempt = { slug: string; sent: boolean };

// UNIQUE(slug) makes retries safe even when an earlier INSERT response was lost.
// The caller retains this attempt until success, logout or leaving the page.
export async function ensureCreatedBand(client: SupabaseClient, attempt: BandCreationAttempt,
  name: string, description: string): Promise<string> {
  async function recover() {
    const result = await client.from("bands").select("id").eq("slug", attempt.slug).maybeSingle();
    if (result.error) throw new Error("Band creation could not be confirmed");
    return result.data?.id as string | undefined;
  }
  if (attempt.sent) {
    const id = await recover();
    if (id) return id;
  }
  attempt.sent = true;
  try {
    // Minimal response: SELECT membership can depend on the AFTER INSERT
    // creator trigger. Read the ID in a separate request after it commits.
    await client.from("bands").insert({ name, slug: attempt.slug, description: description || null });
  } catch { /* Resolve an ambiguous INSERT by its stable unique slug. */ }
  const id = await recover();
  if (id) return id;
  throw new Error("Band creation could not be confirmed");
}

"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabase: SupabaseClient | undefined;

export function getSupabaseBrowserClient() {
  if (supabase) return supabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para conectar ao Supabase.",
    );
  }

  // Supabase expects the project root; a configured path like /rest/v1 would
  // otherwise prefix Auth URLs when the SDK resolves its endpoint paths.
  const projectUrl = new URL(supabaseUrl);
  supabase = createClient(projectUrl.origin, supabasePublishableKey);
  return supabase;
}

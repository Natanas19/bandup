"use client";

import { useEffect, useState } from "react";
import { normalizeDisplayName } from "@/lib/display-name";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Presentation only; the existing session boundary continues to authorize the area.
export default function PersonalAccountName() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let verifiedUserId = "";
    let timer: number | undefined;
    try {
      const client = getSupabaseBrowserClient();
      async function refresh(expectedId?: string) {
        const ticket = ++generation;
        try {
          const { data, error } = await client.auth.getUser();
          if (!active || ticket !== generation) return;
          if (error || !data.user || (expectedId && data.user.id !== expectedId)) {
            verifiedUserId = ""; setName(null); return;
          }
          verifiedUserId = data.user.id;
          setName(normalizeDisplayName(data.user.user_metadata?.display_name));
        } catch {
          if (active && ticket === generation) { verifiedUserId = ""; setName(null); }
        }
      }
      const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        generation++;
        window.clearTimeout(timer);
        const nextId = session?.user.id;
        if (!nextId || nextId !== verifiedUserId) { verifiedUserId = ""; setName(null); }
        if (!nextId) return;
        // SDK calls stay outside the Auth callback to avoid its notification lock.
        timer = window.setTimeout(() => { void refresh(nextId); }, 0);
      });
      void refresh();
      const onProfileUpdated = () => { void refresh(verifiedUserId || undefined); };
      window.addEventListener("bandup:personal-profile-updated", onProfileUpdated);
      return () => {
        active = false; generation++; window.clearTimeout(timer);
        listener.subscription.unsubscribe();
        window.removeEventListener("bandup:personal-profile-updated", onProfileUpdated);
      };
    } catch { setName(null); }
    return () => { active = false; generation++; window.clearTimeout(timer); };
  }, []);
  return <p className="mt-2 break-words font-semibold text-content [overflow-wrap:anywhere]">{name ?? "Meu Painel"}</p>;
}

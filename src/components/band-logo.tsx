"use client";

import { useEffect, useState } from "react";
import ProfileAvatar from "./profile-avatar";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { bandPhotoSession } from "@/lib/band-logo-upload";
import { safeBandLogo } from "@/lib/public-band-data";

export default function BandLogo({ bandId, name }: { bandId: string; name: string }) {
  const [image, setImage] = useState<{ bandId: string; url: string | null } | null>(null);
  useEffect(() => {
    const client = getSupabaseBrowserClient(), controller = new AbortController();
    let owner: string | undefined;
    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (owner && session?.user.id !== owner) { controller.abort(); setImage(null); }
    });
    void (async () => {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user || controller.signal.aborted) return;
      owner = data.user.id;
      const { scoped, verify } = await bandPhotoSession(client, owner, controller.signal);
      const result = await scoped.from("bands").select("logo_url").eq("id", bandId).maybeSingle();
      await verify();
      if (result.error || controller.signal.aborted) return;
      setImage({ bandId, url: safeBandLogo(result.data?.logo_url ?? null, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local") });
    })().catch(() => { if (!controller.signal.aborted) setImage(null); });
    return () => { controller.abort(); subscription.subscription.unsubscribe(); };
  }, [bandId]);
  return <ProfileAvatar name={name} imageUrl={image?.bandId === bandId ? image.url : null} />;
}

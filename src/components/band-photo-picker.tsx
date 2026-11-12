"use client";

import { useEffect, useState } from "react";
import ProfileAvatar from "./profile-avatar";
import { validateBandLogoFile } from "@/lib/band-logo-upload";

export default function BandPhotoPicker({ file, disabled, onChange, currentImageUrl, name = "Banda" }: {
  file: File | null; disabled: boolean; onChange: (file: File | null) => void;
  currentImageUrl?: string | null; name?: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="text-sm font-medium text-content-label">Foto da banda (opcional)</legend>
    <ProfileAvatar name={name} imageUrl={file ? preview : currentImageUrl ?? null} />
    <label htmlFor="band-photo" className="block text-sm text-content-muted">JPG, PNG ou WebP, até 2 MB. A imagem ficará pública.</label>
    <input id="band-photo" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="band-photo-error"
      className="block w-full rounded-xl border border-outline bg-surface px-4 py-3 text-base md:text-sm text-content outline-none focus:border-input-focus focus:ring-4 focus:ring-input-ring" onChange={event => {
        const selected = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (!selected || disabled) return;
        const invalid = validateBandLogoFile(selected); setError(invalid ?? "");
        if (!invalid) onChange(selected);
      }} />
    {file && <button type="button" className="text-sm font-semibold text-accent" onClick={() => { setError(""); onChange(null); }}>Remover foto</button>}
    <p id="band-photo-error" role="alert" className="text-sm text-danger">{error}</p>
  </fieldset>;
}

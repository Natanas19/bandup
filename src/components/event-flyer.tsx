"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EVENT_FLYER_MIME_TYPES, EVENT_FLYER_URL_SECONDS, signEventFlyer, validateEventFlyer } from "@/lib/event-flyer";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const action = "inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-50";
const image = "max-h-[min(65vh,36rem)] max-w-full rounded-xl object-contain";

export function EventFlyerLayout({ path, title, children }: {
  path?: string | null; title: string; children: ReactNode;
}) {
  if (!path) return <>{children}</>;
  return <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:gap-4">
    <div className="w-full lg:w-36 lg:max-w-64 lg:shrink-0">
      <EventFlyer path={path} title={title} thumbnail />
    </div>
    <div className="min-w-0 flex-1">{children}</div>
  </div>;
}

export function EventFlyer({ path, title, thumbnail = false }: { path: string; title: string; thumbnail?: boolean }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ path: string; revision: number; url?: string; message?: string }>();
  useEffect(() => {
    let active = true;
    const expiresAt = Date.now() + EVENT_FLYER_URL_SECONDS * 1000;
    let expiry: ReturnType<typeof setTimeout>;
    const expire = () => setResult({ path, revision, message: "O link do flyer expirou." });
    void Promise.resolve().then(() => signEventFlyer(getSupabaseBrowserClient(), path)).then(url => {
      if (!active) return;
      if (Date.now() >= expiresAt) { expire(); return; }
      setResult({ path, revision, url });
      expiry = setTimeout(expire, expiresAt - Date.now());
    }).catch(() => {
      if (active) setResult({ path, revision, message: "Não foi possível abrir o flyer. Verifique sua conexão e seu acesso." });
    });
    return () => { active = false; clearTimeout(expiry); };
  }, [path, revision]);

  const current = result?.path === path && result.revision === revision ? result : undefined;
  const spacing = thumbnail ? "" : "mt-3 ";
  if (!current) return <p role="status" className={`${spacing}text-sm text-content-muted`}>Carregando flyer...</p>;
  if (!current.url) return <div className={spacing}>
    <p role="status" className="text-sm text-content-muted">{current.message}</p>
    <button type="button" className={action} onClick={() => setRevision(value => value + 1)}>Recarregar flyer</button>
  </div>;
  return <a href={current.url} target="_blank" rel="noopener noreferrer"
    aria-label={`Abrir flyer de ${title} em nova aba`}
    className={`${thumbnail ? "lg:mx-auto " : spacing}block w-fit max-w-full rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- private, short-lived URL */}
    <img src={current.url} alt={`Flyer de ${title}`}
      className={thumbnail ? "max-h-48 max-w-full rounded-xl object-contain lg:max-h-36" : image}
      onError={() => setResult({ path, revision, message: "Não foi possível exibir a imagem do flyer." })} />
  </a>;
}

export type FlyerDraft = { file: File } | "remove" | null;

export function EventFlyerField({ path, title, draft, onChange, disabled }: {
  path: string | null; title: string; draft: FlyerDraft; onChange: (draft: FlyerDraft) => void; disabled: boolean;
}) {
  const file = draft && draft !== "remove" ? draft.file : null;
  const [preview, setPreview] = useState<{ file: File; url: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return <fieldset disabled={disabled} className="min-w-0 space-y-2">
    <legend className="mb-2 text-sm font-medium text-content-label">Flyer do evento (opcional)</legend>
    <label htmlFor="event-flyer" className="block text-sm text-content">{file || (path && draft !== "remove") ? "Substituir flyer" : "Selecionar flyer"}</label>
    <input id="event-flyer" type="file" accept={EVENT_FLYER_MIME_TYPES.join(",")} aria-describedby="event-flyer-help"
      className="block min-h-11 w-full max-w-full rounded-xl border border-outline p-2 text-sm text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"
      onChange={event => {
        const selected = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!selected) return;
        const problem = validateEventFlyer(selected);
        setError(problem ?? "");
        if (!problem) onChange({ file: selected });
      }} />
    <p id="event-flyer-help" className="text-sm text-content-muted">JPEG, PNG ou WebP, até 2 MiB.</p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {file && preview?.file === file && <>
      {/* eslint-disable-next-line @next/next/no-img-element -- local file preview */}
      <img src={preview.url} alt="Prévia do flyer selecionado" className={image} />
    </>}
    {!draft && path && <EventFlyer path={path} title={title} />}
    {draft === "remove" && <p role="status" className="text-sm text-content-muted">O flyer será removido ao salvar.</p>}
    {(file || (path && draft !== "remove")) && <button type="button" className={action}
      onClick={() => { setError(""); onChange(path ? "remove" : null); }}>Remover flyer</button>}
    {path && draft && <button type="button" className={action}
      onClick={() => { setError(""); onChange(null); }}>Manter flyer atual</button>}
  </fieldset>;
}

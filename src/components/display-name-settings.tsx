"use client";

import { useRef, useState, type FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeDisplayName } from "@/lib/display-name";

export default function DisplayNameSettings({ initialName, onSaved }: { initialName?: unknown; onSaved?: (name: string) => void }) {
  const [name, setName] = useState(normalizeDisplayName(initialName) ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const normalized = normalizeDisplayName(name);
    if (!normalized) { setMessage("Informe um nome de até 80 caracteres, sem e-mail ou caracteres de controle."); return; }
    pending.current = true; setBusy(true); setMessage("");
    try {
      // Auth applies this update exclusively to the authenticated account.
      const { error } = await getSupabaseBrowserClient().auth.updateUser({ data: { display_name: normalized } });
      if (error) { setMessage("Não foi possível salvar seu nome. Tente novamente."); return; }
      setName(normalized); setMessage("Nome salvo na sua conta. O nome ficará disponível para suas bandas quando o compartilhamento for habilitado.");
      onSaved?.(normalized);
    } catch { setMessage("Não foi possível salvar seu nome. Tente novamente."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <form onSubmit={save} className="mt-6 min-w-0 space-y-3 rounded-xl border border-nav-border p-4 text-left">
    <label htmlFor="account-display-name" className="block text-sm font-semibold text-content">Nome de exibição</label>
    {!normalizeDisplayName(initialName) && <p className="text-sm text-content-muted">Complete sua conta escolhendo um nome de exibição.</p>}
    <input id="account-display-name" autoComplete="nickname" aria-describedby="account-display-name-help" required maxLength={80} value={name} disabled={busy}
      onChange={event => setName(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-outline bg-surface px-4 py-3 text-base text-content" />
    <p id="account-display-name-help" className="text-xs text-content-muted">Escolha como deseja se apresentar. O nome não comprova identidade. Não use seu e-mail.</p>
    <button disabled={busy} className="min-h-11 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-on-primary disabled:opacity-50">{busy ? "Salvando..." : "Salvar meu nome"}</button>
    {message && <p role="status" className="break-words text-sm text-content">{message}</p>}
  </form>;
}

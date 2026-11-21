"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { requestPasswordRecovery } from "@/lib/password-recovery";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const sending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setMessage("");
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Informe um e-mail válido.");
      return;
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      setMessage(await requestPasswordRecovery(address, window.location.origin));
    } catch {
      setError("A recuperação de senha está indisponível neste endereço.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return <main className="flex flex-1 items-center justify-center px-4 py-8">
    <section className="w-full max-w-md space-y-4 rounded-panel border border-outline bg-surface p-6 shadow-app-panel">
      <h1 className="text-2xl font-semibold text-content">Esqueci minha senha</h1>
      <form onSubmit={submit} className="space-y-4">
        <label htmlFor="recovery-email" className="block text-sm font-medium text-content-label">E-mail da conta</label>
        <input id="recovery-email" name="email" type="email" autoComplete="email" required disabled={busy}
          value={email} onChange={event => setEmail(event.target.value)}
          className="w-full rounded-control border border-outline bg-surface px-4 py-3 text-base text-content focus:outline-none focus:ring-4 focus:ring-input-ring" />
        <button type="submit" disabled={busy}
          className="min-h-11 w-full rounded-control bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-60">
          {busy ? "Enviando…" : "Enviar link de recuperação"}
        </button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {message && <p role="status" className="text-sm text-content">{message}</p>}
      <Link href="/login" className="inline-flex min-h-11 items-center rounded-control text-sm font-semibold text-brand underline focus-visible:ring-4 focus-visible:ring-focus">Voltar ao login</Link>
    </section>
  </main>;
}

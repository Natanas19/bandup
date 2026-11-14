"use client";

import { useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LeaveBandButton({ bandId, disabled = false, onBusyChange, onLeft }: {
  bandId: string;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onLeft: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "busy" | "uncertain" | "left">("idle");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  // Preserve the original actor across uncertain responses and account changes.
  const actor = useRef<string | null>(null);

  function finish() {
    setPhase("left");
    onLeft();
    // A full navigation reloads memberships, the profile selector and dashboard.
    window.location.replace("/dashboard");
  }

  async function act() {
    if (inFlight.current || disabled || phase === "left") return;
    const checking = phase === "uncertain";
    if (!checking && !window.confirm("Sair desta banda? Você perderá o acesso. Se for o último administrador, o integrante mais antigo será promovido automaticamente. Sem outro integrante, a saída será bloqueada.")) return;
    inFlight.current = true;
    setPhase("busy");
    setMessage("");
    onBusyChange(true);
    let sent = checking;
    try {
      const client = getSupabaseBrowserClient();
      const { data: account, error: authError } = await client.auth.getUser();
      if (authError || !account.user || (checking && account.user.id !== actor.current)) {
        setPhase(checking ? "uncertain" : "idle");
        setMessage("Não foi possível validar sua sessão. Entre com a mesma conta e tente novamente.");
        return;
      }
      if (!checking) {
        actor.current = account.user.id;
        sent = true;
        const { data, error } = await client.rpc("bandup_leave_band", { p_band_id: bandId });
        if (!error && data?.status === "left" && typeof data.administration_transferred === "boolean") {
          finish();
          return;
        }
        if (error && ["PBL01", "42501", "55P03", "40001", "40P01", "25000", "PGRST202", "42883"].includes(error.code)) {
          setPhase("idle");
          setMessage(error.code === "PBL01"
            ? "Você é o único integrante. Outro integrante precisa fazer parte da banda antes da sua saída."
            : ["55P03", "40001", "40P01"].includes(error.code)
              ? "Há outra alteração em andamento na banda. Sua saída não foi concluída. Tente novamente em instantes."
            : error.code === "42501"
              ? "Não foi possível autorizar sua saída ou a banda está indisponível. Verifique sua sessão e atualize a página."
            : error.code === "25000"
              ? "A saída não foi concluída porque a configuração da transação é incompatível. Tente novamente mais tarde."
            : ["PGRST202", "42883"].includes(error.code)
              ? "A saída voluntária ainda não está disponível neste ambiente."
              : "A banda está indisponível ou mudou durante a operação. Atualize a página antes de tentar novamente.");
          return;
        }
      }
      // Missing/malformed replies and transport failures do not prove rollback.
      // A fresh verified identity is required before interpreting RLS-filtered rows.
      const { data: verified, error: verifyError } = await client.auth.getUser();
      if (verifyError || verified.user?.id !== actor.current) throw new Error("Session changed");
      const { data: membership, error } = await client.from("band_members")
        .select("id").eq("band_id", bandId).eq("user_id", actor.current!).maybeSingle();
      if (!error && !membership) { finish(); return; }
      setPhase("uncertain");
      setMessage("Não foi possível confirmar a saída. Verifique o acesso novamente antes de tentar outra saída.");
    } catch {
      setPhase(sent ? "uncertain" : "idle");
      setMessage(sent ? "O resultado da saída é incerto. Verifique seu acesso novamente."
        : "Não foi possível validar sua sessão agora. Tente novamente.");
    } finally {
      inFlight.current = false;
      onBusyChange(false);
    }
  }

  return <section aria-label="Saída voluntária" className="mt-7 rounded-2xl border border-danger-border bg-surface p-4 sm:p-5">
    <p className="text-sm text-content-muted">Ao sair, você perde o acesso à banda. Suas tarefas permanecem na banda, sem atribuição a você.</p>
    {message && <p role="alert" className="mt-3 text-sm text-danger">{message}</p>}
    <button type="button" disabled={disabled || phase === "busy" || phase === "left"}
      onClick={() => void act()} className="mt-3 min-h-11 rounded-xl border border-danger-border px-2.5 py-1.5 text-xs font-semibold text-danger hover:bg-danger-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60 md:min-h-9">
      {phase === "busy" ? "Verificando saída..." : phase === "left" ? "Saída confirmada" : phase === "uncertain" ? "Verificar meu acesso" : "Sair da banda"}
    </button>
    {phase === "uncertain" && <button type="button" onClick={() => window.location.replace("/dashboard")} className="ml-4 inline-flex min-h-11 items-center text-sm text-brand">Ir para meu painel</button>}
  </section>;
}

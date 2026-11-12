"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import NavigationIcon from "@/components/navigation-icon";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const result = await getSupabaseBrowserClient().auth.signOut();
      if (result.error) { setError("Não foi possível sair agora. Tente novamente."); return; }
      router.replace("/login");
    } catch {
      setError("Não foi possível sair agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button type="button" onClick={signOut} disabled={busy}
      className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2.5 text-left text-sm font-semibold text-content-muted transition hover:bg-accent-soft hover:text-danger focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-60">
      <NavigationIcon name="LogOut" />{busy ? "Saindo..." : "Sair"}
    </button>
    {error && <p role="alert" className="px-3 py-2 text-xs text-danger">{error}</p>}
  </>;
}

const bandComingSoonItems = [
  { icon: "Globe", label: "Perfil público" },
  { icon: "Link", label: "Links" },
  { icon: "Store", label: "Loja" },
  { icon: "Ticket", label: "Ingressos" },
] as const;

function SettingsLinks({ href, onNavigate, showBandFeatures = false }: {
  href: string;
  onNavigate?: () => void;
  showBandFeatures?: boolean;
}) {
  const pathname = usePathname();
  const base = "flex min-h-11 items-center gap-3 rounded-control px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus";
  return <>
    <Link href={href} onClick={onNavigate} aria-current={pathname === href ? "page" : undefined}
      className={`${base} ${pathname === href ? "bg-accent-soft text-brand" : "text-content-muted hover:bg-accent-soft hover:text-brand"}`}>
      <NavigationIcon name="Settings" />Configurações
    </Link>
    <span aria-disabled="true" className="flex min-h-11 items-center justify-between gap-2 rounded-control px-3 py-2.5 text-sm text-content-faint">
      <span className="inline-flex items-center gap-3"><NavigationIcon name="Bell" />Notificações</span>
      <span className="rounded-full bg-disabled-surface px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-content-subtle">Em breve</span>
    </span>
    <span aria-disabled="true" className="flex min-h-11 items-center justify-between gap-2 rounded-control px-3 py-2.5 text-sm text-content-faint">
      <span className="inline-flex items-center gap-3"><NavigationIcon name="ShieldCheck" />Privacidade</span>
      <span className="rounded-full bg-disabled-surface px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-content-subtle">Em breve</span>
    </span>
    {showBandFeatures && bandComingSoonItems.map(item => <span key={item.label} aria-disabled="true" className="flex min-h-11 items-center justify-between gap-2 rounded-control px-3 py-2.5 text-sm text-content-faint">
      <span className="inline-flex items-center gap-3"><NavigationIcon name={item.icon} />{item.label}</span>
      <span className="rounded-full bg-disabled-surface px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-content-subtle">Em breve</span>
    </span>)}
  </>;
}

export function WorkspaceSettingsNavigation({ href }: { href: string }) {
  return <div className="border-t border-outline-subtle pt-3">
    <nav aria-label="Configurações e conta" className="space-y-1">
      <SettingsLinks href={href} />
      <SignOutButton />
    </nav>
  </div>;
}

export function WorkspaceSettingsMenu({ href, showBandFeatures = false }: { href: string; showBandFeatures?: boolean }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => { if (menu.current) menu.current.open = false; };
  return <details ref={menu} className="group relative">
    <summary aria-label="Abrir configurações" className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-control border border-outline bg-surface text-content-muted hover:border-accent-border hover:text-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
      <NavigationIcon name="Settings" />
    </summary>
    <div className="absolute right-0 top-full z-40 mt-2 max-h-[calc(100dvh-6rem)] w-64 overflow-y-auto overscroll-contain rounded-panel border border-outline bg-surface p-2 shadow-app-panel">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-widest text-content-muted">Configurações e conta</p>
      <nav aria-label="Configurações rápidas" className="space-y-1">
        <SettingsLinks href={href} onNavigate={close} showBandFeatures={showBandFeatures} />
        <div className="my-1 border-t border-outline-subtle" />
        <SignOutButton />
      </nav>
    </div>
  </details>;
}

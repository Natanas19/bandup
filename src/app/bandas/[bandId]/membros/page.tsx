"use client";

import { Suspense, useEffect, useState } from "react";
import { UnavailableNotificationTarget } from "@/components/notification-target";
import Link from "next/link";
import BandEntryFlow from "@/components/band-entry-flow";
import { BandInvitations } from "@/components/band-invitations";
import { BAND_ENTRY_BACKEND_VALIDATED } from "@/lib/band-entry";
import BandNavigation from "@/components/band-navigation";
import { BandWorkspaceInfo } from "@/components/band-workspace";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadMemberAvatars } from "@/lib/member-avatars";
import { loadMemberNames } from "@/lib/display-name";
import { recordWriteError } from "@/lib/record-permissions";
import LeaveBandButton from "@/components/leave-band-button";
import ProfileAvatar from "@/components/profile-avatar";
import { safeBandLogo } from "@/lib/public-band-data";

type Member = {
  user_id: string;
  role: "admin" | "member";
};

type ListedMember = Member & { label: string; isCurrentUser: boolean };
type PageState = "loading" | "unauthenticated" | "unavailable" | "error" | "ready";

export default function BandMembersPage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [bandName, setBandName] = useState("");
  const [bandLogoUrl, setBandLogoUrl] = useState<string | null>(null);
  const [members, setMembers] = useState<ListedMember[]>([]);
  const [memberAvatars, setMemberAvatars] = useState<{ bandId: string; urls: Map<string, string> } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [membersRevision, setMembersRevision] = useState(0);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [left, setLeft] = useState(false);

  async function removeMember(member: ListedMember) {
    if (!isAdmin || member.role !== "member" || member.isCurrentUser || removingMemberId || leaving || left) return;
    if (!window.confirm(`Remover ${member.label} da banda? Essa pessoa perderá o acesso à banda.`)) return;

    setMemberActionError("");
    setRemovingMemberId(member.user_id);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (sessionError || !user) {
        setMemberActionError("Sua sessão expirou. Entre novamente para remover integrantes.");
        return;
      }

      const { data: currentMembership, error: membershipError } = await supabase
        .from("band_members")
        .select("role")
        .eq("band_id", bandId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membershipError || currentMembership?.role !== "admin") {
        setMemberActionError("Somente administradores da banda podem remover integrantes.");
        setMembersRevision((revision) => revision + 1);
        return;
      }

      const { data: removedMembership, error: removeError } = await supabase
        .from("band_members")
        .delete()
        .eq("band_id", bandId)
        .eq("user_id", member.user_id)
        .eq("role", "member")
        .select("id")
        .maybeSingle();

      if (removeError) {
        setMemberActionError(recordWriteError(removeError, "remover este integrante"));
        return;
      }
      if (!removedMembership) {
        setMemberActionError("O integrante ou seu papel mudou. A lista será atualizada.");
        setMembersRevision((revision) => revision + 1);
        return;
      }

      setMembersRevision((revision) => revision + 1);
    } catch {
      setMemberActionError("Não foi possível remover o integrante agora. Tente novamente.");
    } finally {
      setRemovingMemberId(null);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadMembers() {
      if (membersRevision === 0) setPageState("loading");

      try {
        const supabase = getSupabaseBrowserClient();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (!isMounted) return;
        if (sessionError) {
          setPageState("error");
          return;
        }

        const user = sessionData.session?.user;
        if (!user) {
          setPageState("unauthenticated");
          return;
        }

        const { data: membership, error: membershipError } = await supabase
          .from("band_members")
          .select("user_id, role")
          .eq("band_id", bandId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!isMounted) return;
        if (membershipError) {
          setPageState("error");
          return;
        }
        if (!membership) {
          setPageState("unavailable");
          return;
        }

        const { data: band, error: bandError } = await supabase
          .from("bands")
          .select("name, logo_url")
          .eq("id", bandId)
          .maybeSingle();

        if (!isMounted) return;
        if (bandError) {
          setPageState("error");
          return;
        }
        if (!band) {
          setPageState("unavailable");
          return;
        }

        const { data: memberRows, error: membersError } = await supabase
          .from("band_members")
          .select("user_id, role")
          .eq("band_id", bandId)
          .order("user_id");

        if (!isMounted) return;
        if (membersError) {
          setPageState("error");
          return;
        }

        // Membership was verified above. The RPC returns only presentation names
        // for this band and fails closed when unavailable; it never exposes Auth data.
        const memberNames = await loadMemberNames(supabase, bandId, true);
        if (!isMounted) return;

        const orderedMembers = [...((memberRows ?? []) as Member[])].sort((first, second) => {
          if (first.user_id === user.id) return -1;
          if (second.user_id === user.id) return 1;
          return first.user_id.localeCompare(second.user_id);
        });
        let otherMemberNumber = 0;
        const listedMembers = orderedMembers.map((member) => ({
          ...member,
          isCurrentUser: member.user_id === user.id,
          label: memberNames.get(member.user_id)
            ?? (member.user_id === user.id ? "Você" : `Integrante ${++otherMemberNumber}`),
        }));

        setIsAdmin(membership.role === "admin");
        setBandName(band.name);
        setBandLogoUrl(safeBandLogo(band.logo_url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local"));
        setMembers(listedMembers);
        setPageState("ready");
        setMemberAvatars(null);
        // Optional enrichment must never delay the list or its administrative actions.
        void loadMemberAvatars(supabase, bandId, listedMembers.map(member => member.user_id))
          .then(urls => { if (isMounted) setMemberAvatars({ bandId, urls }); });
      } catch {
        if (isMounted) setPageState("error");
      }
    }

    void loadMembers();
    return () => {
      isMounted = false;
    };
  }, [bandId, membersRevision]);

  if (left) return <main className="flex-1 p-8"><p role="status">Seu acesso à banda terminou. Abrindo seu painel...</p><button type="button" onClick={() => window.location.replace("/dashboard")}>Ir para meu painel</button></main>;

  if (pageState !== "ready") {
    return (
      <main className="flex flex-1 justify-center px-4 py-8 sm:px-6 sm:py-12">
        <section className="w-full max-w-2xl">
          <Link href={`/bandas/${bandId}`} className="inline-flex min-h-11 items-center rounded-xl border border-accent-border px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-accent-soft focus:outline-none focus:ring-4 focus:ring-input-ring">
            ← Voltar para a visão geral
          </Link>
          <div className="mt-6 rounded-3xl border border-nav-border bg-surface p-8 text-center shadow-app-dashboard sm:p-10">
            {pageState === "loading" ? (
              <p className="text-content-muted">Carregando integrantes...</p>
            ) : pageState === "unauthenticated" ? (
              <>
                <h1 className="text-2xl font-semibold text-content">Entre para continuar</h1>
                <p className="mt-3 text-sm text-content-muted">Faça login para acessar os integrantes da banda.</p>
                <Link href="/login" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Ir para o login</Link>
              </>
            ) : pageState === "unavailable" ? (
              <>
                <h1 className="text-2xl font-semibold text-content">Banda não encontrada</h1>
                <p className="mt-3 text-sm text-content-muted">Essa banda não existe ou você não tem acesso a ela.</p>
              </>
            ) : (
              <p role="alert" className="text-sm text-danger">Não foi possível carregar os integrantes agora. Tente novamente.</p>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
      <div className="mx-auto w-full max-w-4xl">
        <BandWorkspaceInfo name={bandName} />
        <div className="md:hidden"><BandNavigation bandId={bandId} activeSection="membros" /></div>

        <header className="mt-6 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em] text-accent uppercase">Membros</p>
            <div className="mt-2 flex min-w-0 items-center gap-3">
              <ProfileAvatar name={bandName} imageUrl={bandLogoUrl} />
              <h1 className="min-w-0 break-words text-3xl font-semibold tracking-tight text-content [overflow-wrap:anywhere] sm:text-4xl">{bandName}</h1>
            </div>
            <p className="mt-2 text-sm text-content-muted">Integrantes que fazem parte desta banda.</p>
          </div>
          <span className="inline-flex w-fit shrink-0 rounded-full border border-accent-border bg-accent-soft px-3.5 py-2 text-sm font-semibold text-brand">
            {members.length} {members.length === 1 ? "integrante" : "integrantes"}
          </span>
        </header>

        {BAND_ENTRY_BACKEND_VALIDATED && isAdmin && <>
          <BandEntryFlow key={`requests:${bandId}`} bandId={bandId} onMembersChanged={() => setMembersRevision(value => value + 1)} />
        </>}
        {(!BAND_ENTRY_BACKEND_VALIDATED || !isAdmin) && <Suspense fallback={null}><UnavailableNotificationTarget /></Suspense>}
        {isAdmin && <BandInvitations key={`invitations:${bandId}`} bandId={bandId} />}

        {memberActionError && <p role="alert" className="mt-5 rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger">{memberActionError}</p>}

        {members.length === 0 ? (
          <section className="mt-7 rounded-2xl border border-dashed border-accent-border bg-surface px-5 py-10 text-center sm:py-14">
            <h2 className="text-lg font-semibold text-content">Nenhum integrante encontrado.</h2>
            <p className="mt-2 text-sm text-content-muted">Os integrantes da banda aparecerão aqui.</p>
          </section>
        ) : (
          <section aria-label="Lista de integrantes" aria-busy={removingMemberId !== null} className="mt-7 space-y-3">
            {members.map((member) => (
              <article key={member.user_id} className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-nav-border bg-surface p-4 shadow-app-card sm:p-5">
                <div className="flex min-w-0 items-center gap-3">
                  <ProfileAvatar name={member.label}
                    imageUrl={memberAvatars?.bandId === bandId ? memberAvatars.urls.get(member.user_id) ?? null : null} />
                  <p className="truncate text-sm font-semibold text-content sm:text-base">{member.label}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                  <span className="rounded-full bg-disabled-surface px-3 py-1.5 text-xs font-semibold text-content-label sm:text-sm">
                    {member.role === "admin" ? "Administrador" : "Membro"}
                  </span>
                  {isAdmin && member.role === "member" && !member.isCurrentUser && <button
                    type="button"
                    aria-label={`Remover ${member.label} da banda`}
                    disabled={removingMemberId !== null || leaving}
                    onClick={() => void removeMember(member)}
                    className="min-h-11 rounded-xl border border-danger-border px-2.5 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60 md:min-h-9"
                  >
                    {removingMemberId === member.user_id ? "Removendo..." : "Remover integrante"}
                  </button>}
                </div>
              </article>
            ))}
          </section>
        )}
        <LeaveBandButton key={bandId} bandId={bandId} disabled={removingMemberId !== null}
          onBusyChange={setLeaving} onLeft={() => { setLeft(true); setMembers([]); setIsAdmin(false); }} />
      </div>
    </main>
  );
}

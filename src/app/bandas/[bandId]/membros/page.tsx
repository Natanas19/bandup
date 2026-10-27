"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BandNavigation from "@/components/band-navigation";
import { BandWorkspaceInfo } from "@/components/band-workspace";
import { useParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Member = {
  user_id: string;
  role: "admin" | "member";
};

type ListedMember = Member & { label: string };
type PageState = "loading" | "unauthenticated" | "unavailable" | "error" | "ready";

export default function BandMembersPage() {
  const { bandId } = useParams<{ bandId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [bandName, setBandName] = useState("");
  const [members, setMembers] = useState<ListedMember[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function loadMembers() {
      setPageState("loading");

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
          .select("user_id")
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
          .select("name")
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

        const orderedMembers = [...((memberRows ?? []) as Member[])].sort((first, second) => {
          if (first.user_id === user.id) return -1;
          if (second.user_id === user.id) return 1;
          return first.user_id.localeCompare(second.user_id);
        });
        let otherMemberNumber = 1;
        const listedMembers = orderedMembers.map((member) => ({
          ...member,
          label: member.user_id === user.id ? "Você" : `Integrante ${++otherMemberNumber}`,
        }));

        setBandName(band.name);
        setMembers(listedMembers);
        setPageState("ready");
      } catch {
        if (isMounted) setPageState("error");
      }
    }

    void loadMembers();
    return () => {
      isMounted = false;
    };
  }, [bandId]);

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
            <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight text-content sm:text-4xl">{bandName}</h1>
            <p className="mt-2 text-sm text-content-muted">Integrantes que fazem parte desta banda.</p>
          </div>
          <span className="inline-flex w-fit shrink-0 rounded-full border border-accent-border bg-accent-soft px-3.5 py-2 text-sm font-semibold text-brand">
            {members.length} {members.length === 1 ? "integrante" : "integrantes"}
          </span>
        </header>

        {members.length === 0 ? (
          <section className="mt-7 rounded-2xl border border-dashed border-accent-border bg-surface px-5 py-10 text-center sm:py-14">
            <h2 className="text-lg font-semibold text-content">Nenhum integrante encontrado.</h2>
            <p className="mt-2 text-sm text-content-muted">Os integrantes da banda aparecerão aqui.</p>
          </section>
        ) : (
          <section aria-label="Lista de integrantes" className="mt-7 space-y-3">
            {members.map((member) => (
              <article key={member.user_id} className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-nav-border bg-surface p-4 shadow-app-card sm:p-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                    {member.label === "Você" ? "V" : "♪"}
                  </span>
                  <p className="truncate text-sm font-semibold text-content sm:text-base">{member.label}</p>
                </div>
                <span className="shrink-0 rounded-full bg-disabled-surface px-3 py-1.5 text-xs font-semibold text-content-label sm:text-sm">
                  {member.role === "admin" ? "Administrador" : "Membro"}
                </span>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

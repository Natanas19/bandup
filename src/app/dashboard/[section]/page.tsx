import Link from "next/link";
import { notFound } from "next/navigation";
import PersonalTasks from "@/components/personal-tasks";
import PersonalAgenda from "@/components/personal-agenda";
import ThemeSelector from "@/components/theme-selector";

const sections = [
  { slug: "links", title: "Links", description: "Você poderá organizar seus links pessoais em uma próxima etapa." },
  { slug: "perfil-publico", title: "Perfil público", description: "A publicação do seu perfil pessoal ainda não está disponível." },
  { slug: "configuracoes", title: "Configurações", description: "Preferências de aparência e ajustes adicionais de conta." },
];

export default async function DashboardSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === "tarefas") return <PersonalTasks />;
  if (section === "agenda") return <PersonalAgenda />;
  const item = sections.find(candidate => candidate.slug === section);
  if (!item) notFound();
  return <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
    <div className="mx-auto w-full max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Meu Painel</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-content sm:text-4xl">{item.title}</h1>
      <section className="mt-7 rounded-2xl border border-dashed border-accent-border bg-surface p-6 sm:p-10">
        <h2 className="text-xl font-semibold text-content">{section === "configuracoes" ? "Preferências" : "Em breve"}</h2>
        <p className="mt-3 text-sm leading-6 text-content-muted">{item.description}</p>
        {section === "configuracoes" && <div className="mt-6 border-t border-outline-subtle pt-5">
          <h3 className="text-base font-semibold text-content">Aparência</h3>
          <p className="mt-1 text-sm text-content-muted">Escolha como o BandUp será exibido neste dispositivo.</p>
          <ThemeSelector className="mt-4" />
        </div>}
        <p className="mt-2 text-sm leading-6 text-content-muted">Você pode continuar usando os recursos de cada banda no respectivo painel.</p>
        <Link href="/dashboard" className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-accent-border px-4 py-3 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus">Voltar à visão geral</Link>
      </section>
    </div>
  </main>;
}

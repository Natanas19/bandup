import type { ReactNode } from "react";
import BandDeletionPanel from "@/components/band-deletion-panel";
import BandNavigation from "@/components/band-navigation";
import ThemeSelector from "@/components/theme-selector";

export default function BandSettings({ bandId, activeSection, children }: {
  bandId: string;
  activeSection: "configuracoes" | "perfil-publico";
  children?: ReactNode;
}) {
  return <>
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full min-w-0 max-w-5xl">
        <div className="md:hidden"><BandNavigation bandId={bandId} activeSection={activeSection} /></div>
        <section aria-labelledby="band-appearance-title" className="mt-6 rounded-2xl border border-nav-border bg-surface p-5 sm:p-6">
          <h1 id="band-appearance-title" className="text-lg font-semibold text-content">Aparência</h1>
          <ThemeSelector className="mt-4" />
        </section>
        {children}
      </div>
    </main>
    <BandDeletionPanel key={bandId} bandId={bandId} />
  </>;
}

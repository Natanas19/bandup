"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import NavigationIcon, { type NavigationIconName } from "@/components/navigation-icon";

const futureSections = ["Loja", "Eventos", "Ingressos", "Música", "Fotos"] as const;
type FutureSection = (typeof futureSections)[number];
type Menu = "add" | "Editar perfil" | "Links" | FutureSection;

const sectionIcons = {
  "Editar perfil": "Settings",
  Links: "Link",
  Loja: "Store",
  Eventos: "CalendarDays",
  Ingressos: "Ticket",
  Música: "Music",
  Fotos: "Image",
} satisfies Record<Exclude<Menu, "add">, NavigationIconName>;

const triggerStyle = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus";
const actionStyle = "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus";
const cardLabelStyle = "flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-3 text-left text-content";
const cardActionStyle = `${cardLabelStyle} transition hover:bg-accent-soft active:bg-surface-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus`;
const scrollMargin = "scroll-mb-[calc(8rem+env(safe-area-inset-bottom))] group-has-[[data-band-nav-expanded=true]]/band:scroll-mb-[calc(13rem+env(safe-area-inset-bottom))] md:scroll-mb-4 md:group-has-[[data-band-nav-expanded=true]]/band:scroll-mb-4";
const panelStyle = `mb-2 rounded-lg bg-surface-muted p-1 ${scrollMargin}`;

export default function BandPublicSections({ bandId, isAdmin, linksManager }: {
  bandId: string;
  isAdmin: boolean;
  linksManager: ReactNode;
}) {
  const [sections, setSections] = useState<readonly FutureSection[]>(futureSections);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);
  const openPanel = useRef<HTMLDivElement>(null);
  const linksPanel = useRef<HTMLDivElement>(null);
  const available = futureSections.filter(section => !sections.includes(section));
  const editProfileHref = `/bandas/${encodeURIComponent(bandId)}/perfil`;
  const linksManagerId = "band-section-links-manager";

  useEffect(() => {
    if (menu) openPanel.current?.scrollIntoView({ block: "nearest" });
  }, [menu]);

  useEffect(() => {
    if (linksOpen) linksPanel.current?.scrollIntoView({ block: "start" });
  }, [linksOpen]);

  function toggleMenu(next: Menu) {
    setMenu(menu === next ? null : next);
  }

  function toggleLinks() {
    setLinksOpen(open => !open);
  }

  function closeOnEscape(event: KeyboardEvent<HTMLElement>, current: Menu) {
    if (event.defaultPrevented || event.key !== "Escape" || menu !== current) return;
    event.preventDefault();
    setMenu(null);
    event.currentTarget.querySelector<HTMLButtonElement>("[data-section-trigger]")?.focus();
  }

  function changeSection(section: FutureSection, add: boolean) {
    setSections(current => futureSections.filter(item => item === section ? add : current.includes(item)));
    setNotice(add ? `${section} adicionada à organização temporária.` : `${section} removida da organização temporária.`);
    setMenu(null);
    addButton.current?.focus();
  }

  return (
    <section aria-label="Seções do perfil público" className="mt-5 min-w-0">
      {isAdmin && <div onKeyDown={event => closeOnEscape(event, "add")}>
        <div className="flex min-h-11 items-center justify-end">
          <button ref={addButton} type="button" data-section-trigger className={triggerStyle}
            aria-label="Adicionar seção" aria-expanded={menu === "add"} aria-controls="band-section-add"
            onClick={() => toggleMenu("add")}>
            <NavigationIcon name="Plus" />
          </button>
        </div>
        <div id="band-section-add" hidden={menu !== "add"}
          ref={menu === "add" ? openPanel : undefined} className={panelStyle}>
          {available.length ? available.map(label => (
            <button key={label} type="button" className={actionStyle} onClick={() => changeSection(label, true)}>
              Adicionar {label}<span className="text-xs text-content-muted">Em breve</span>
            </button>
          )) : <p className="px-3 py-2 text-sm text-content-muted">Todas as seções estão na lista.</p>}
        </div>
      </div>}
      <p role="status" className="sr-only">{notice}</p>
      <ul className="space-y-3">
        {(["Editar perfil", "Links", ...sections] as const).map((label) => {
          const future = label !== "Editar perfil" && label !== "Links";
          const panelId = `band-section-${label.replace(" ", "-").toLowerCase()}`;
          const expanded = menu === label;
          const subtitle = label === "Editar perfil" ? "Foto, nome e descrição"
            : label === "Links" ? "Links públicos" : "Em breve";
          const cardContent = (
            <>
              <span className="shrink-0 rounded-xl bg-accent-soft p-2 text-brand">
                <NavigationIcon name={sectionIcons[label]} />
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="block font-semibold">{label}</span>
                <span className="block text-sm text-content-muted">{subtitle}</span>
              </span>
            </>
          );
          return (
            <li key={label} onKeyDown={event => closeOnEscape(event, label)}>
              <div className="flex min-w-0 items-center gap-1 rounded-2xl border border-nav-border bg-surface pr-2 shadow-app-card">
                {label === "Editar perfil" && isAdmin ? (
                  <Link href={editProfileHref} className={cardActionStyle}>{cardContent}</Link>
                ) : label === "Links" ? (
                  <button type="button" className={cardActionStyle} aria-expanded={linksOpen}
                    aria-controls={linksManagerId} onClick={toggleLinks}>{cardContent}</button>
                ) : (
                  <span className={cardLabelStyle}>{cardContent}</span>
                )}
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" data-section-trigger className={triggerStyle} aria-label={`Ações de ${label}`}
                    aria-expanded={expanded} aria-controls={panelId} onClick={() => toggleMenu(label)}>
                    <NavigationIcon name="Ellipsis" />
                  </button>
                </div>
              </div>
              <div id={panelId} hidden={!expanded} ref={expanded ? openPanel : undefined} className={`mt-2 ${panelStyle}`}>
                {label === "Editar perfil" && (isAdmin ? (
                  <Link href={editProfileHref} className={actionStyle}>Editar foto, nome e descrição</Link>
                ) : <p className="px-3 py-2 text-sm text-content-muted">Somente administradores podem editar o perfil.</p>)}
                {label === "Links" && <button type="button" className={actionStyle}
                  aria-expanded={linksOpen} aria-controls={linksManagerId} onClick={toggleLinks}>
                  {linksOpen ? "Recolher links" : isAdmin ? "Gerenciar links" : "Ver links"}
                </button>}
                {future && (isAdmin ? <button type="button" className={actionStyle}
                  onClick={() => changeSection(label, false)}>Remover da lista</button>
                : <p className="px-3 py-2 text-sm text-content-muted">Seção disponível em breve.</p>)}
              </div>
              {label === "Links" && <div id={linksManagerId} ref={linksPanel} hidden={!linksOpen}
                className="scroll-mt-4 pb-3">
                {linksManager}
              </div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

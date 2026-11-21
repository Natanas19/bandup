"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import NavigationIcon from "@/components/navigation-icon";
import {
  BandPublicLinksError, deleteBandPublicLink, getBandPublicLinkUrl, listBandPublicLinks,
  PUBLIC_LINK_LIMIT, PUBLIC_LINK_URL_LIMIT, publicLinkPlatforms, saveBandPublicLink, swapBandPublicLinkPositions,
  type BandPublicLink, type PublicLinkInput, type PublicLinkPlatform,
} from "@/lib/band-public-links";

type Draft = PublicLinkInput & { id?: string };
type Props = { bandId: string; isAdmin: boolean; renderEditor?: (links: BandPublicLink[] | null, manager: ReactNode) => ReactNode };
const buttonStyles = "inline-flex min-h-11 items-center justify-center rounded-xl border border-accent-border px-4 py-2 text-sm font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-60 aria-disabled:opacity-60";
const menuActionStyles = "inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:opacity-50 aria-disabled:opacity-50";
const fieldStyles = "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-outline bg-surface px-3 py-2 text-base text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus";
const errorStyles = "rounded-xl border border-danger-border bg-danger-surface p-3 text-sm text-danger";

export default function BandPublicLinks(props: Props) {
  return <LinkManager key={props.bandId} {...props} />;
}

function LinkManager({ bandId, isAdmin, renderEditor }: Props) {
  const [links, setLinks] = useState<BandPublicLink[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [openLinkActions, setOpenLinkActions] = useState<string | null>(null);
  const mutation = useRef(false);
  const linkActions = useRef<HTMLDivElement>(null);
  const platformField = useRef<HTMLSelectElement>(null);
  const editing = draft !== null;

  useEffect(() => {
    const controller = new AbortController();
    void listBandPublicLinks(bandId, controller.signal).then(rows => {
      if (!controller.signal.aborted) setLinks(rows);
    }, () => {
      if (!controller.signal.aborted) setLoadError(true);
    });
    return () => controller.abort();
  }, [bandId, revision]);

  useEffect(() => {
    if (editing) platformField.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (openLinkActions) linkActions.current?.scrollIntoView({ block: "nearest" });
  }, [openLinkActions]);

  function reload() {
    setOpenLinkActions(null);
    setLinks(null);
    setLoadError(false);
    setRevision(value => value + 1);
  }

  async function mutate(action: () => Promise<void>, message: string, onSuccess = reload) {
    if (!isAdmin || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
      setDraft(null);
      setSuccess(message);
      onSuccess();
    } catch (cause) {
      const knownError = cause instanceof BandPublicLinksError;
      setError(knownError ? cause.message : "Não foi possível confirmar a alteração. Confira a lista antes de tentar novamente.");
      if (!knownError || cause.refreshList) reload();
    } finally {
      setBusy(false);
      mutation.current = false;
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !links) return;
    void mutate(() => saveBandPublicLink(bandId, draft, links, draft.id), draft.id ? "Link atualizado." : "Link adicionado.");
  }

  function remove(link: BandPublicLink) {
    if (!isAdmin || mutation.current || !window.confirm(`Excluir o link “${link.label || publicLinkPlatforms[link.platform]}”?`)) return;
    void mutate(() => deleteBandPublicLink(bandId, link.id), "Link excluído.");
  }

  function move(link: BandPublicLink, neighbor?: BandPublicLink) {
    if (!neighbor || editing) return;
    void mutate(() => swapBandPublicLinkPositions(bandId, link, neighbor), "Ordem dos links atualizada.", () => {
      // Keep the row mounted so the move button can retain keyboard focus.
      setLinks(current => current?.map(item => {
        if (item.id === link.id) return { ...item, position: neighbor.position };
        if (item.id === neighbor.id) return { ...item, position: link.position };
        return item;
      }).sort((a, b) => a.position - b.position) ?? null);
    });
  }

  function startAddingLink() {
    if (!isAdmin || !links || links.length >= PUBLIC_LINK_LIMIT || editing || mutation.current) return;
    setOpenLinkActions(null);
    setError("");
    setDraft({ platform: "custom", label: null, url: "" });
  }

  const manager = (
      <section aria-label="Links públicos" className="min-w-0">
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {links && <p className="text-xs text-content-muted" aria-live="polite">{links.length}/{PUBLIC_LINK_LIMIT} links utilizados</p>}
            {isAdmin && <button type="button" disabled={!links || links.length >= PUBLIC_LINK_LIMIT || busy || editing}
              onClick={startAddingLink} className={menuActionStyles}>Adicionar link</button>}
          </div>
          {success && <p role="status" className="text-sm text-brand">{success}</p>}
          {error && <p role="alert" className={errorStyles}>{error}</p>}
          {loadError ? (
            <div className="space-y-3">
              <p role="alert" className={errorStyles}>Não foi possível carregar os links públicos.</p>
              <button type="button" className={buttonStyles} onClick={reload}>Tentar novamente</button>
            </div>
          ) : links === null ? <p role="status" className="text-sm text-content-muted">Carregando links públicos...</p> : (
            <>
              {isAdmin && draft && (
                <form onSubmit={submit} aria-label={draft.id ? "Editar link público" : "Adicionar link público"} aria-busy={busy}
                  className="rounded-xl border border-outline bg-surface-muted p-4">
                  <fieldset disabled={busy} className="min-w-0 space-y-3">
                    <label className="block text-sm font-medium text-content-label">
                      Plataforma
                      <select ref={platformField} className={fieldStyles} value={draft.platform}
                        onChange={event => setDraft({ ...draft, platform: event.target.value as PublicLinkPlatform })}>
                        {Object.entries(publicLinkPlatforms).map(([platform, name]) => <option key={platform} value={platform}>{name}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-medium text-content-label">
                      URL
                      <input type="url" required maxLength={PUBLIC_LINK_URL_LIMIT} className={fieldStyles} value={draft.url}
                        placeholder="https://exemplo.com" onChange={event => setDraft({ ...draft, url: event.target.value })} />
                    </label>
                    <label className="block text-sm font-medium text-content-label">
                      Rótulo opcional
                      <input type="text" className={fieldStyles} value={draft.label ?? ""}
                        onChange={event => setDraft({ ...draft, label: event.target.value })} />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className={buttonStyles} disabled={!draft.id && links.length >= PUBLIC_LINK_LIMIT}>{busy ? "Salvando..." : "Salvar link"}</button>
                      <button type="button" className={buttonStyles} onClick={() => { setDraft(null); setError(""); }}>Cancelar</button>
                    </div>
                  </fieldset>
                </form>
              )}
              {links.length === 0 ? <p className="text-sm text-content-muted">Nenhum link público cadastrado.</p> : (
                <ol className="divide-y divide-nav-border border-y border-nav-border">
                  {links.map((link, index) => {
                    const platform = publicLinkPlatforms[link.platform];
                    const url = getBandPublicLinkUrl(link.url, link.platform);
                    const name = link.label || platform;
                    const actionsOpen = openLinkActions === link.id;
                    const actionsId = `band-public-link-actions-${link.id}`;
                    return (
                      <li key={link.id} className="min-w-0 py-2" onKeyDown={event => {
                        if (event.key !== "Escape" || !actionsOpen) return;
                        event.preventDefault();
                        setOpenLinkActions(null);
                        event.currentTarget.querySelector<HTMLButtonElement>("[data-link-actions-trigger]")?.focus();
                      }}>
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold text-content">{name}{link.label && <span className="ml-2 font-normal text-content-muted">({platform})</span>}</p>
                            {url ? <a href={url} title={link.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-brand underline">{link.url}</a>
                              : <p className="text-sm text-danger">Endereço indisponível.</p>}
                          </div>
                          {isAdmin && <button type="button" data-link-actions-trigger aria-label={`Ações do link ${name}`}
                            title={`Ações do link ${name}`} aria-expanded={actionsOpen} aria-controls={actionsId}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"
                            onClick={() => {
                              setOpenLinkActions(actionsOpen ? null : link.id);
                            }}><NavigationIcon name="Ellipsis" /></button>}
                        </div>
                        {isAdmin && <div id={actionsId} hidden={!actionsOpen} ref={actionsOpen ? linkActions : undefined}
                          role="group" aria-label={`Ações do link ${name}`}
                          className="scroll-mb-[calc(8rem+env(safe-area-inset-bottom))] group-has-[[data-band-nav-expanded=true]]/band:scroll-mb-[calc(13rem+env(safe-area-inset-bottom))] md:scroll-mb-4">
                          {actionsOpen && <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-surface-muted p-1 sm:flex sm:justify-end">
                            <button type="button" className={menuActionStyles} disabled={busy || editing} aria-label={`Editar link ${name}`}
                              onClick={() => { setOpenLinkActions(null); setError(""); setDraft(link); }}>Editar</button>
                            <button type="button" className={menuActionStyles} aria-label={`Subir link ${name}`}
                              aria-disabled={busy || editing || index === 0} onClick={() => move(link, links[index - 1])}>Subir</button>
                            <button type="button" className={menuActionStyles} aria-label={`Descer link ${name}`}
                              aria-disabled={busy || editing || index === links.length - 1} onClick={() => move(link, links[index + 1])}>Descer</button>
                            <button type="button" className={`${menuActionStyles} text-danger`} disabled={busy || editing} aria-label={`Excluir link ${name}`}
                              onClick={() => remove(link)}>Excluir</button>
                          </div>}
                        </div>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </div>
      </section>
  );
  return renderEditor ? renderEditor(links, manager) : manager;
}

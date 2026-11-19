"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import NavigationIcon from "@/components/navigation-icon";
import { bindDetailsDismiss } from "@/lib/details-dismiss";
import { notificationHref } from "@/lib/notification-destination";
import {
  notificationSource,
  type NotificationSnapshot,
  type NotificationSource,
} from "@/lib/notifications";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const actionClass = "inline-flex min-h-11 items-center rounded-control px-2 text-left text-xs font-semibold text-brand hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-disabled:cursor-default aria-disabled:text-content-muted aria-disabled:hover:bg-transparent";

export default function NotificationsMenu({ source = notificationSource }: { source?: NotificationSource }) {
  const router = useRouter();
  const menu = useRef<HTMLDetailsElement>(null);
  const request = useRef<{ writing: boolean } | null>(null);
  const headingId = useId();
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"load" | "write" | null>(null);

  const run = useCallback(async (write?: () => Promise<NotificationSnapshot>, onSuccess?: () => void) => {
    if (request.current?.writing || (!write && request.current)) return;
    const current = { writing: Boolean(write) };
    request.current = current;
    setBusy(true);
    setFailed(null);
    try {
      const result = await (write ? write() : source.load());
      if (request.current === current) {
        setSnapshot(result);
        onSuccess?.();
      }
    } catch {
      if (request.current === current) {
        if (!write) setSnapshot(null);
        setFailed(write ? "write" : "load");
      }
    } finally {
      if (request.current === current) {
        request.current = null;
        setBusy(false);
      }
    }
  }, [source]);

  useEffect(() => {
    const unbind = menu.current ? bindDetailsDismiss(menu.current) : undefined;
    return () => unbind?.();
  }, []);

  useEffect(() => {
    void run();
    return () => { request.current = null; };
  }, [run]);

  const unread = snapshot?.unreadCount ?? 0;
  const countLabel = unread === 1 ? "1 não lida" : `${unread} não lidas`;

  return <details ref={menu} className="shrink-0 md:relative"
    onToggle={event => { if (event.currentTarget.open) void run(); }}>
    <summary aria-label={`Notificações${snapshot ? `, ${countLabel}` : ""}`}
      className="relative flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-control border border-outline bg-surface text-content hover:border-accent-border hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
      <NavigationIcon name="Bell" />
      {unread > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-0.5 text-center text-[0.6rem] font-bold leading-4 text-on-primary">{unread > 99 ? "99+" : unread}</span>}
    </summary>

    <section aria-labelledby={headingId}
      className="absolute inset-x-0 top-full z-40 mt-2 flex max-h-[min(32rem,calc(100dvh-10rem-env(safe-area-inset-bottom)))] flex-col overflow-hidden rounded-panel border border-outline bg-surface shadow-app-panel md:left-auto md:right-0 md:w-96">
      <div className="flex flex-wrap items-center justify-between gap-x-2 border-b border-outline-subtle px-3 py-2">
        <h2 id={headingId} className="font-semibold text-content">Notificações</h2>
        {snapshot && <button type="button" className={actionClass} aria-disabled={busy || unread === 0}
          onClick={() => { if (!busy && unread > 0) void run(() => source.markAllRead(snapshot.recipientId)); }}>
          Marcar todas como lidas
        </button>}
      </div>
      {failed && <div className="px-3 py-2">
        <p role="alert" className="text-sm text-content">
          {failed === "load" ? "Não foi possível carregar as notificações." : "Não foi possível confirmar a atualização das notificações."}
        </p>
        <button type="button" className={actionClass} onClick={() => void run()}>
          {failed === "load" ? "Tentar novamente" : "Recarregar notificações"}
        </button>
      </div>}
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {!snapshot && !failed && <p role="status" className="p-4 text-sm text-content-muted">Carregando notificações…</p>}
        {snapshot && snapshot.items.length === 0 && <p className="p-4 text-sm text-content-muted">Nenhuma notificação.</p>}
        {!!snapshot?.items.length && <ul className="divide-y divide-outline-subtle">
          {snapshot.items.map(item => {
            const descriptionId = `${headingId}-${item.id}`;
            const destination = notificationHref(item.reference);
            const disabled = busy || (item.read && !destination);
            const openDestination = () => {
              if (!destination) return;
              if (menu.current) {
                menu.current.open = false;
                menu.current.querySelector("summary")?.focus({ preventScroll: true });
              }
              router.push(destination);
            };
            return <li key={item.id}>
              <button type="button" aria-disabled={disabled}
                aria-label={destination ? `Abrir conteúdo: ${item.title}, ${item.read ? "lida" : "não lida"}` : item.read ? `Lida: ${item.title}` : `Marcar como lida: ${item.title}`}
                aria-describedby={descriptionId}
                className={`block w-full px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${item.read ? "" : "bg-accent-soft"} ${disabled ? "cursor-default" : "cursor-pointer hover:bg-accent-soft hover:underline"}`}
                onClick={disabled ? undefined : () => {
                  if (item.read) openDestination();
                  else void run(() => source.markRead(item.id, snapshot.recipientId), openDestination);
                }}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-semibold text-content">{item.title}</span>
                  <span className={`shrink-0 text-xs font-semibold ${item.read ? "text-content-muted" : "text-brand"}`}>{item.read ? "Lida" : "Não lida"}</span>
                </span>
                <span id={descriptionId} className="block">
                  <span className="mt-0.5 block break-words text-sm text-content">{item.message}</span>
                  <span className="mt-1 block break-words text-xs text-content-muted">
                    {item.origin && <>{item.origin} <span aria-hidden="true">·</span>{" "}</>}
                    <time dateTime={item.createdAt}>{dateFormat.format(new Date(item.createdAt))}</time>
                  </span>
                  {!destination && <span className="mt-1 block text-xs text-content-muted">Sem destino disponível.</span>}
                </span>
              </button>
            </li>;
          })}
        </ul>}
      </div>
    </section>
  </details>;
}

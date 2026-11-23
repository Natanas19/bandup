const threshold = 76;
const directionThreshold = 6;
const excluded = "a, button, input, select, textarea, label, form, summary, nav, dialog, [contenteditable]:not([contenteditable=false]), [role=button], [role=menu], [role=listbox], [role=dialog], [data-no-pull-refresh]";
const editing = "input, select, textarea, form, [contenteditable]:not([contenteditable=false])";
const blocking = "dialog[open], [aria-modal=true], form[aria-busy=true]";

export const pullRefreshTouchEvents = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;
type PullRefreshTouchEvent = typeof pullRefreshTouchEvents[number];

export type PullRefreshDiagnostics = {
  standalone: boolean;
  maxTouchPoints: number;
  cssSupported: boolean;
  listenersInstalled: boolean;
  reason: string;
  events: Partial<Record<PullRefreshTouchEvent, { count: number; cancelable: boolean }>>;
};

export function usesServerRefresh(pathname: string) {
  // The public profile is force-dynamic and reads without caching.
  return /^\/b\/[^/]+\/?$/.test(pathname);
}

export function installPullToRefresh(doc: Document, browser: Window, callbacks: {
  isRefreshing: () => boolean;
  onPull: (distance: number, ready: boolean) => void;
  onRefresh: () => void;
  onDiagnostics?: (snapshot: PullRefreshDiagnostics) => void;
}) {
  const maxTouchPoints = browser.navigator.maxTouchPoints || 0;
  const supportsOverscroll = () => !!(browser as Window & { CSS?: typeof CSS }).CSS?.supports("overscroll-behavior-y", "none");
  const cssSupported = (maxTouchPoints || callbacks.onDiagnostics) ? supportsOverscroll() : false;
  const diagnostics: PullRefreshDiagnostics | undefined = callbacks.onDiagnostics && {
    standalone: (browser.navigator as Navigator & { standalone?: boolean }).standalone === true
      || browser.matchMedia?.("(display-mode: standalone)").matches === true,
    maxTouchPoints,
    cssSupported,
    listenersInstalled: false,
    reason: !maxTouchPoints ? "Sem pontos de toque" : !cssSupported ? "CSS overscroll-behavior-y: none indisponível" : "Aguardando gesto",
    events: {},
  };

  function report(type: PullRefreshTouchEvent, { cancelable }: TouchEvent, reason?: string) {
    if (!diagnostics) return;
    diagnostics.events[type] = { count: (diagnostics.events[type]?.count ?? 0) + 1, cancelable };
    if (reason) diagnostics.reason = reason;
    callbacks.onDiagnostics?.({ ...diagnostics, events: { ...diagnostics.events } });
  }

  // Leave older browsers to handle their own native pull gesture.
  if (!maxTouchPoints || !cssSupported) {
    if (!diagnostics) return;
    callbacks.onDiagnostics?.({ ...diagnostics, events: {} });
    // Observe delivery even when the refresh listeners are gated off.
    const observe = (event: TouchEvent) => report(event.type as PullRefreshTouchEvent, event);
    for (const type of pullRefreshTouchEvents) doc.addEventListener(type, observe, { passive: true });
    return () => {
      for (const type of pullRefreshTouchEvents) doc.removeEventListener(type, observe);
    };
  }

  const root = doc.documentElement;
  const overscrollClass = "overscroll-y-none";
  root.classList.add(overscrollClass);
  let gesture: { x: number; y: number; id: number; url: string; claimed: boolean } | null = null;

  function clear() {
    if (gesture?.claimed) callbacks.onPull(0, false);
    gesture = null;
  }

  function pullBlocker() {
    if (!(browser.scrollY <= 0 && (doc.scrollingElement?.scrollTop ?? 0) <= 0)) return "Página fora do topo";
    if ((browser.visualViewport?.scale ?? 1) !== 1) return "Zoom ativo";
    if (callbacks.isRefreshing()) return "Atualização em andamento";
    if (doc.activeElement?.closest(editing)) return "Campo em edição";
    if (doc.querySelector(blocking)) return "Modal ou formulário ocupado";
  }

  function inNestedScroll(target: Element) {
    for (let node: Element | null = target; node && node !== root && node !== doc.body; node = node.parentElement) {
      if (/^(auto|scroll|overlay)$/.test(browser.getComputedStyle(node).overflowY)) return true;
    }
    return false;
  }

  function start(event: TouchEvent) {
    clear();
    const blocker = event.touches.length !== 1 ? "Quantidade de toques diferente de 1" : pullBlocker();
    if (blocker) return report("touchstart", event, blocker);
    const target = event.target as Element | null;
    if (!target?.closest || target.closest(excluded)) return report("touchstart", event, "Alvo excluído");
    if (inNestedScroll(target)) return report("touchstart", event, "Área de rolagem interna");
    const touch = event.touches[0];
    gesture = { x: touch.clientX, y: touch.clientY, id: touch.identifier, url: browser.location.href, claimed: false };
    report("touchstart", event, "Toque inicial aceito");
  }

  function move(event: TouchEvent) {
    if (!gesture) return report("touchmove", event);
    const touch = event.touches[0];
    const blocker = event.touches.length !== 1 || touch?.identifier !== gesture.id
      ? "Toque inicial mudou"
      : pullBlocker() ?? (!event.cancelable ? "touchmove não cancelável" : undefined);
    if (blocker) {
      clear();
      return report("touchmove", event, blocker);
    }
    const deltaX = Math.abs(touch.clientX - gesture.x);
    const deltaY = touch.clientY - gesture.y;
    if (Math.max(deltaX, Math.abs(deltaY)) < directionThreshold && !gesture.claimed) {
      return report("touchmove", event, "Aguardando direção");
    }
    if (deltaY <= 0 || deltaY < deltaX * 1.5) {
      clear();
      return report("touchmove", event, "Direção fora do gesto de puxar para baixo");
    }
    event.preventDefault();
    gesture.claimed = true;
    callbacks.onPull(Math.min(deltaY, threshold + 20), deltaY >= threshold);
    report("touchmove", event, deltaY >= threshold ? "Distância atingida" : "Puxada abaixo de 76 px");
  }

  function end(event: TouchEvent) {
    if (!gesture) return report("touchend", event);
    const touch = event.changedTouches[0];
    let blocker: string | undefined;
    if (!gesture.claimed) blocker = "Gesto não assumido";
    else if (touch?.identifier !== gesture.id || event.touches.length) blocker = "Toque final incompatível";
    else if (!(touch.clientY - gesture.y >= threshold)) blocker = "Soltou antes de 76 px";
    else if (!(touch.clientY - gesture.y >= Math.abs(touch.clientX - gesture.x) * 1.5)) blocker = "Direção final incompatível";
    else if (gesture.url !== browser.location.href) blocker = "Navegação durante o gesto";
    else blocker = pullBlocker();
    clear();
    report("touchend", event, blocker ?? "Atualização solicitada");
    if (!blocker) callbacks.onRefresh();
  }

  function cancel(event: TouchEvent) {
    const reason = gesture ? "Gesto cancelado pelo navegador" : undefined;
    clear();
    report("touchcancel", event, reason);
  }

  doc.addEventListener("touchstart", start, { passive: true });
  doc.addEventListener("touchmove", move, { passive: false });
  doc.addEventListener("touchend", end, { passive: true });
  doc.addEventListener("touchcancel", cancel, { passive: true });
  if (diagnostics) {
    diagnostics.listenersInstalled = true;
    callbacks.onDiagnostics?.({ ...diagnostics, events: {} });
  }
  return () => {
    doc.removeEventListener("touchstart", start);
    doc.removeEventListener("touchmove", move);
    doc.removeEventListener("touchend", end);
    doc.removeEventListener("touchcancel", cancel);
    root.classList.remove(overscrollClass);
  };
}

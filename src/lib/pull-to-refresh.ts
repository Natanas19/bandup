const threshold = 76;
const directionThreshold = 6;
const excluded = "a, button, input, select, textarea, label, form, summary, nav, dialog, [contenteditable]:not([contenteditable=false]), [role=button], [role=menu], [role=listbox], [role=dialog], [data-no-pull-refresh]";
const editing = "input, select, textarea, form, [contenteditable]:not([contenteditable=false])";
const blocking = "dialog[open], [aria-modal=true], form[aria-busy=true]";

export function usesServerRefresh(pathname: string) {
  // The public profile is force-dynamic and reads without caching.
  return /^\/b\/[^/]+\/?$/.test(pathname);
}

export function installPullToRefresh(doc: Document, browser: Window, callbacks: {
  isRefreshing: () => boolean;
  onPull: (distance: number, ready: boolean) => void;
  onRefresh: () => void;
}) {
  // Leave older browsers to handle their own native pull gesture.
  if (!browser.navigator.maxTouchPoints || !(browser as Window & { CSS?: typeof CSS }).CSS?.supports("overscroll-behavior-y", "none")) return;

  const root = doc.documentElement;
  const overscrollClass = "overscroll-y-none";
  root.classList.add(overscrollClass);
  let gesture: { x: number; y: number; id: number; url: string; claimed: boolean } | null = null;

  function clear() {
    if (gesture?.claimed) callbacks.onPull(0, false);
    gesture = null;
  }

  function canPull() {
    return browser.scrollY <= 0 && (doc.scrollingElement?.scrollTop ?? 0) <= 0
      && (browser.visualViewport?.scale ?? 1) === 1
      && !callbacks.isRefreshing() && !doc.activeElement?.closest(editing) && !doc.querySelector(blocking);
  }

  function inNestedScroll(target: Element) {
    for (let node: Element | null = target; node && node !== root && node !== doc.body; node = node.parentElement) {
      if (/^(auto|scroll|overlay)$/.test(browser.getComputedStyle(node).overflowY)) return true;
    }
    return false;
  }

  function start(event: TouchEvent) {
    clear();
    if (event.touches.length !== 1 || !canPull()) return;
    const target = event.target as Element | null;
    if (!target?.closest || target.closest(excluded) || inNestedScroll(target)) return;
    const touch = event.touches[0];
    gesture = { x: touch.clientX, y: touch.clientY, id: touch.identifier, url: browser.location.href, claimed: false };
  }

  function move(event: TouchEvent) {
    if (!gesture) return;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || touch?.identifier !== gesture.id || !canPull() || !event.cancelable) {
      clear();
      return;
    }
    const deltaX = Math.abs(touch.clientX - gesture.x);
    const deltaY = touch.clientY - gesture.y;
    if (Math.max(deltaX, Math.abs(deltaY)) < directionThreshold && !gesture.claimed) return;
    if (deltaY <= 0 || deltaY < deltaX * 1.5) {
      clear();
      return;
    }
    event.preventDefault();
    gesture.claimed = true;
    callbacks.onPull(Math.min(deltaY, threshold + 20), deltaY >= threshold);
  }

  function end(event: TouchEvent) {
    const touch = event.changedTouches[0];
    const ready = gesture?.claimed && touch?.identifier === gesture.id && !event.touches.length
      && touch.clientY - gesture.y >= threshold
      && touch.clientY - gesture.y >= Math.abs(touch.clientX - gesture.x) * 1.5
      && gesture.url === browser.location.href && canPull();
    clear();
    if (ready) callbacks.onRefresh();
  }

  doc.addEventListener("touchstart", start, { passive: true });
  doc.addEventListener("touchmove", move, { passive: false });
  doc.addEventListener("touchend", end, { passive: true });
  doc.addEventListener("touchcancel", clear, { passive: true });
  return () => {
    doc.removeEventListener("touchstart", start);
    doc.removeEventListener("touchmove", move);
    doc.removeEventListener("touchend", end);
    doc.removeEventListener("touchcancel", clear);
    root.classList.remove(overscrollClass);
  };
}

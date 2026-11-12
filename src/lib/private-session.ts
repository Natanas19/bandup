import type { SupabaseClient } from "@supabase/supabase-js";

export type PrivateSessionSnapshot = {
  phase: "checking" | "ready" | "signed-out" | "forbidden" | "error";
  epoch: number;
};

export function getPrivateScope(pathname: string): string | null {
  if (pathname === "/meu-perfil" || pathname.startsWith("/meu-perfil/")) return "/meu-perfil";
  if (pathname === "/dashboard" || pathname === "/dashboard/perfil") return "/dashboard";
  if (pathname === "/bandas/nova" || pathname === "/descobrir") return pathname;
  const band = /^\/bandas\/([^/]+)(?:\/|$)/.exec(pathname);
  return band ? `band:${band[1]}` : null;
}

// One active controller above all private pages. Never await SDK operations inside
// onAuthStateChange: the SDK can hold its Auth lock while notifying subscribers.
export function createPrivateSessionController(
  client: SupabaseClient, browser: Window, doc: Document,
  storageKey: string, bandId?: string,
) {
  let snapshot: PrivateSessionSnapshot = { phase: "checking", epoch: 0 };
  const listeners = new Set<(value: PrivateSessionSnapshot) => void>();
  let disposed = false;
  let generation = 0;
  let identity = "";
  let verifiedUserId = "";
  let expiresAt = 0;
  let expiryTimer: number | undefined;
  let deferredTimer: number | undefined;
  let deadlineTimer: number | undefined;
  const publish = (phase: PrivateSessionSnapshot["phase"], remount = false) => {
    if (disposed) return;
    snapshot = { phase, epoch: snapshot.epoch + (remount ? 1 : 0) };
    listeners.forEach((listener) => listener(snapshot));
  };
  const clearExpiry = () => { browser.clearTimeout(expiryTimer); expiryTimer = undefined; };
  const signedOut = () => {
    generation++;
    identity = "";
    verifiedUserId = "";
    clearExpiry();
    browser.clearTimeout(deferredTimer);
    browser.clearTimeout(deadlineTimer);
    publish("signed-out", true);
  };
  const removeInvalidSession = async (ticket: number) => {
    if (disposed || ticket !== generation) return;
    // Clear UI before removing local credentials. A removal failure stays blocked,
    // rather than bouncing between login and an invalid persisted session.
    publish("checking", true);
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (disposed || ticket !== generation) return;
      if (error) publish("error"); else signedOut();
    } catch { if (!disposed && ticket === generation) publish("error"); }
  };
  const invalidAuth = (error: { status?: number; name?: string; code?: string } | null) =>
    error?.status === 401 || error?.status === 403 || error?.name === "AuthSessionMissingError" ||
    ["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired",
      "bad_jwt", "user_banned", "user_not_found"].includes(error?.code ?? "");

  async function check(conceal = false) {
    if (disposed) return;
    const ticket = ++generation;
    browser.clearTimeout(deadlineTimer);
    if (conceal) publish("checking", true);
    // A hung request must not keep private content visible indefinitely.
    deadlineTimer = browser.setTimeout(() => {
      if (ticket === generation && !disposed) { generation++; clearExpiry(); publish("error", true); }
    }, 10000);
    try {
      const { data, error } = await client.auth.getSession();
      if (disposed || ticket !== generation) return;
      if (error) {
        if (invalidAuth(error)) await removeInvalidSession(ticket); else publish("error", true);
        return;
      }
      const session = data.session;
      if (!session) { signedOut(); return; }
      if (!session.expires_at || session.expires_at * 1000 <= Date.now()) {
        await removeInvalidSession(ticket); return;
      }
      const { data: account, error: accountError } = await client.auth.getUser();
      if (disposed || ticket !== generation) return;
      if (accountError) {
        if (invalidAuth(accountError)) await removeInvalidSession(ticket); else publish("error", true);
        return;
      }
      if (!account.user || account.user.id !== session.user.id) {
        await removeInvalidSession(ticket); return;
      }
      const request = client.from("band_members").select("band_id, role").eq("user_id", account.user.id);
      const { data: memberships, error: accessError } = bandId ? await request.eq("band_id", bandId) : await request;
      if (disposed || ticket !== generation) return;
      if (accessError) {
        if (accessError.code === "PGRST301" || accessError.code === "PGRST303") await removeInvalidSession(ticket);
        else publish("error", true);
        return;
      }
      if (bandId && !memberships?.length) { clearExpiry(); publish("forbidden", true); return; }
      const fingerprint = JSON.stringify([account.user.id, (memberships ?? [])
        .map((member) => [member.band_id, member.role]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
      const changed = identity !== fingerprint;
      identity = fingerprint;
      verifiedUserId = account.user.id;
      expiresAt = session.expires_at * 1000;
      clearExpiry();
      expiryTimer = browser.setTimeout(() => { void check(true); },
        Math.min(2147483647, Math.max(1, session.expires_at * 1000 - Date.now())));
      publish("ready", changed);
    } catch { if (!disposed && ticket === generation) publish("error", true); }
    finally { if (ticket === generation) browser.clearTimeout(deadlineTimer); }
  }
  const deferCheck = () => {
    browser.clearTimeout(deferredTimer);
    deferredTimer = browser.setTimeout(() => { void check(); }, 0);
  };
  const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
    if (disposed) return;
    if (event === "SIGNED_OUT" || !session) { signedOut(); return; }
    generation++; // An Auth event wins over every older request.
    browser.clearTimeout(deadlineTimer);
    clearExpiry();
    if (verifiedUserId && verifiedUserId !== session.user.id) publish("checking", true);
    deferCheck();
  });
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== storageKey) return;
    // Native storage events cover Safari iOS 15 versions without BroadcastChannel.
    // Only SDK verification can authorize data; storage is a revocation signal.
    if (event.newValue === null) signedOut();
    else {
      generation++;
      // Parsing may only hide content, never authorize it. A normal refresh of
      // the same account should not discard an in-progress form in another tab.
      let sameAccount = false;
      try { sameAccount = JSON.parse(event.newValue)?.user?.id === verifiedUserId; } catch { /* Revalidate malformed storage. */ }
      if (!sameAccount) publish("checking", true);
      deferCheck();
    }
  };
  const onFocus = () => {
    if (doc.visibilityState !== "hidden") void check(expiresAt <= Date.now());
  };
  const onVisibility = () => { if (doc.visibilityState === "visible") onFocus(); };
  const onPageHide = () => { generation++; clearExpiry(); publish("checking", true); };
  browser.addEventListener("storage", onStorage);
  browser.addEventListener("focus", onFocus);
  browser.addEventListener("online", onFocus);
  browser.addEventListener("pageshow", onFocus);
  browser.addEventListener("pagehide", onPageHide);
  doc.addEventListener("visibilitychange", onVisibility);
  const poll = browser.setInterval(() => { if (doc.visibilityState !== "hidden") void check(); }, 30000);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: (value: PrivateSessionSnapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    check,
    dispose() {
      disposed = true; generation++; listeners.clear();
      subscription.subscription.unsubscribe();
      clearExpiry(); browser.clearTimeout(deferredTimer); browser.clearTimeout(deadlineTimer); browser.clearInterval(poll);
      browser.removeEventListener("storage", onStorage); browser.removeEventListener("focus", onFocus);
      browser.removeEventListener("online", onFocus); browser.removeEventListener("pageshow", onFocus);
      browser.removeEventListener("pagehide", onPageHide); doc.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

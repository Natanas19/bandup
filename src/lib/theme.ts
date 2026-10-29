export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type ThemeSnapshot = { preference: ThemePreference; resolvedTheme: ResolvedTheme };
export const THEME_STORAGE_KEY = "bandup.appearance";

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  return preference === "dark" || (preference === "system" && systemIsDark) ? "dark" : "light";
}

// Self-contained so the very same initializer can run inline before first paint.
// No browser APIs are accessed when this module is imported on the server.
export function initializeTheme(browser: Window, root: HTMLElement, storageKey: string): ThemeSnapshot {
  let preference: ThemePreference = "system";
  try {
    const stored = browser.localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark") preference = stored;
  } catch { /* Storage can be unavailable in restricted browsing contexts. */ }
  let systemIsDark = false;
  try { systemIsDark = browser.matchMedia("(prefers-color-scheme: dark)").matches; }
  catch { /* Browsers without this API fall back to light in automatic mode. */ }
  const resolvedTheme = preference === "dark" || (preference === "system" && systemIsDark) ? "dark" : "light";
  root.setAttribute("data-appearance", preference);
  root.setAttribute("data-theme", resolvedTheme);
  root.style.colorScheme = resolvedTheme;
  return { preference, resolvedTheme };
}

// Only application-owned source and a fixed key are serialized, never stored data.
export const THEME_INITIALIZATION_SCRIPT =
  `try{(${initializeTheme.toString()})(window,document.documentElement,${JSON.stringify(THEME_STORAGE_KEY)})}catch{}`;

export function createThemeController(browser: Window, page: Document) {
  const root = page.documentElement;
  let snapshot = initializeTheme(browser, root, THEME_STORAGE_KEY);
  let media: MediaQueryList | null = null;
  try { media = browser.matchMedia("(prefers-color-scheme: dark)"); } catch { /* Optional browser API. */ }
  const subscribers = new Set<(value: ThemeSnapshot) => void>();
  let disposed = false;

  function readStored() {
    try { return { available: true, value: browser.localStorage.getItem(THEME_STORAGE_KEY) }; }
    catch { return { available: false, value: null }; }
  }
  const stored = readStored();
  // Remember the last observed stored value so a failed write does not undo an
  // in-memory selection when Safari resumes the page.
  let lastStoredValue: string | null | undefined = stored.available ? stored.value : undefined;

  function apply(preference: ThemePreference) {
    if (disposed) return;
    const resolvedTheme = resolveTheme(preference, media?.matches ?? false);
    root.setAttribute("data-appearance", preference);
    root.setAttribute("data-theme", resolvedTheme);
    root.style.colorScheme = resolvedTheme;
    if (snapshot.preference === preference && snapshot.resolvedTheme === resolvedTheme) return;
    snapshot = { preference, resolvedTheme };
    subscribers.forEach((subscriber) => subscriber(snapshot));
  }

  function setPreference(value: ThemePreference) {
    if (disposed) return;
    const preference = normalizeThemePreference(value);
    try {
      browser.localStorage.setItem(THEME_STORAGE_KEY, preference);
      lastStoredValue = preference;
    } catch { /* Keep the selection in memory for this page session. */ }
    apply(preference);
  }

  function onSystemChange() {
    if (snapshot.preference === "system") apply("system");
  }

  function onStorage(event: StorageEvent) {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    try { if (event.storageArea && event.storageArea !== browser.localStorage) return; }
    catch { return; }
    lastStoredValue = event.newValue;
    apply(normalizeThemePreference(event.newValue));
  }

  function refresh() {
    if (page.visibilityState === "hidden") return;
    const current = readStored();
    let preference = snapshot.preference;
    if (current.available && current.value !== lastStoredValue) {
      lastStoredValue = current.value;
      preference = normalizeThemePreference(current.value);
    }
    apply(preference);
  }

  let removeMediaListener = () => {};
  if (media) {
    const query = media;
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onSystemChange);
      removeMediaListener = () => query.removeEventListener("change", onSystemChange);
    } else if (typeof query.addListener === "function") {
      // Older WebKit exposes MediaQueryList.addListener instead of EventTarget.
      query.addListener(onSystemChange);
      removeMediaListener = () => query.removeListener(onSystemChange);
    }
  }
  browser.addEventListener("storage", onStorage);
  browser.addEventListener("focus", refresh);
  browser.addEventListener("pageshow", refresh);
  page.addEventListener("visibilitychange", refresh);
  refresh();

  return {
    getSnapshot: () => snapshot,
    setPreference,
    subscribe(subscriber: (value: ThemeSnapshot) => void) {
      if (!disposed) subscribers.add(subscriber);
      return () => { subscribers.delete(subscriber); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeMediaListener();
      browser.removeEventListener("storage", onStorage);
      browser.removeEventListener("focus", refresh);
      browser.removeEventListener("pageshow", refresh);
      page.removeEventListener("visibilitychange", refresh);
      subscribers.clear();
    },
  };
}

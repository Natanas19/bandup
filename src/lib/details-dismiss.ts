// Share one listener pair per document across the profile and settings menus.
const documents = new WeakMap<Document, { menus: Set<HTMLDetailsElement>; dispose: () => void }>();

export function bindDetailsDismiss(menu: HTMLDetailsElement): () => void {
  const document = menu.ownerDocument;
  let registration = documents.get(document);
  if (!registration) {
    const menus = new Set<HTMLDetailsElement>();
    const pointer = (event: PointerEvent) => {
      for (const details of menus) {
        if (!details.open || event.composedPath().includes(details)) continue;
        const restoreFocus = document.activeElement !== null && details.contains(document.activeElement);
        details.open = false;
        // Do not cancel the pointer: an outside control still receives its focus/click.
        if (restoreFocus) details.querySelector("summary")?.focus({ preventScroll: true });
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      for (const details of menus) {
        if (!details.open || !event.composedPath().includes(details)) continue;
        event.preventDefault();
        details.open = false;
        details.querySelector("summary")?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard);
    registration = { menus, dispose: () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard);
    } };
    documents.set(document, registration);
  }
  registration.menus.add(menu);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    registration.menus.delete(menu);
    if (!registration.menus.size) {
      registration.dispose();
      documents.delete(document);
    }
  };
}

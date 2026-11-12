import { validateAvatarFile } from "./avatar-upload";

export type AvatarDraft = { id: string; email: string; file: File; createdAt: number; ownerId?: string };
export const AVATAR_DRAFT_TTL = 24 * 60 * 60 * 1000;
const databaseName = "bandup-avatar-draft";
const storeName = "draft";
const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function newAvatarAttemptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// One atomic read/modify transaction; stale completions cannot erase newer drafts.
function changeDraft<T>(change: (draft: AvatarDraft | undefined, store: IDBObjectStore) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Draft storage unavailable")); return; }
    const open = indexedDB.open(databaseName, 1);
    let db: IDBDatabase | undefined;
    let tx: IDBTransaction | undefined;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { tx?.abort(); } catch { /* Already completed/aborted. */ }
      db?.close(); reject(new Error("Draft storage unavailable"));
    };
    const timer = setTimeout(fail, 3000);
    open.onupgradeneeded = () => { open.result.createObjectStore(storeName); };
    open.onerror = fail;
    open.onblocked = fail;
    open.onsuccess = () => {
      db = open.result;
      if (settled) { db.close(); return; }
      try { tx = db.transaction(storeName, "readwrite"); } catch { fail(); return; }
      const transaction = tx;
      const store = transaction.objectStore(storeName);
      const request = store.get("pending");
      let result: T;
      request.onsuccess = () => {
        try { result = change(request.result as AvatarDraft | undefined, store); }
        catch { transaction.abort(); }
      };
      transaction.oncomplete = () => { clearTimeout(timer); db?.close(); if (!settled) { settled = true; resolve(result); } };
      transaction.onerror = fail;
      transaction.onabort = fail;
    };
  });
}

export async function saveAvatarDraft(file: File, email: string): Promise<AvatarDraft> {
  if (validateAvatarFile(file) || !normalizeEmail(email)) throw new Error("Invalid photo draft");
  const draft: AvatarDraft = { id: newAvatarAttemptId(), file, email: normalizeEmail(email), createdAt: Date.now() };
  return changeDraft((_previous, store) => { store.put(draft, "pending"); return draft; });
}

export function discardAvatarDraft(expectedId?: string): Promise<void> {
  return changeDraft((draft, store) => {
    if (!expectedId || draft?.id === expectedId) store.delete("pending");
  });
}

export function loadAvatarDraft(user: { id: string; email?: string }): Promise<AvatarDraft | null> {
  return changeDraft((draft, store) => {
    if (!draft) return null;
    // This is only a local privacy/intent check; backend authorization uses JWTs.
    if (draft.email !== normalizeEmail(user.email ?? "") || (draft.ownerId && draft.ownerId !== user.id)
      || !Number.isFinite(draft.createdAt) || Date.now() - draft.createdAt > AVATAR_DRAFT_TTL
      || draft.createdAt > Date.now() || !draft.file || validateAvatarFile(draft.file)) {
      store.delete("pending"); return null;
    }
    const bound = { ...draft, ownerId: user.id };
    store.put(bound, "pending"); return bound;
  });
}

// No credentials: only the immutable arguments needed to replay a lost response.
export type BandDeletionAttempt = {
  version: 1; actorId: string; bandId: string; operationId: string; confirmation: string;
};
export interface BandDeletionAttemptStore {
  read(actorId: string, bandId: string): Promise<BandDeletionAttempt | null>;
  list(actorId: string): Promise<BandDeletionAttempt[]>;
  getOrCreate(actorId: string, bandId: string, confirmation: string): Promise<BandDeletionAttempt>;
  remove(attempt: BandDeletionAttempt): Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validDeletionAttempt(value: unknown): value is BandDeletionAttempt {
  if (!value || typeof value !== "object") return false;
  const a = value as BandDeletionAttempt;
  return a.version === 1 && typeof a.actorId === "string" && typeof a.bandId === "string" && typeof a.operationId === "string"
    && uuid.test(a.actorId) && uuid.test(a.bandId) && uuid.test(a.operationId)
    && typeof a.confirmation === "string" && a.confirmation.length > 0 && !a.confirmation.includes("\0");
}

export function createBandDeletionAttemptStore(
  factory: IDBFactory, project: string, randomUUID: () => string,
): BandDeletionAttemptStore {
  const prefix = `${project}:`;
  const key = (actor: string, band: string) => `${prefix}${actor}:${band}`;
  async function transaction<T>(mode: IDBTransactionMode,
    work: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("bandup-band-deletion-v1", 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("attempts"); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Não foi possível abrir o registro de tentativas."));
      request.onblocked = () => reject(new Error("Feche outras abas e tente novamente."));
    });
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("attempts", mode, { durability: "strict" });
      let answer: T;
      tx.oncomplete = () => { db.close(); resolve(answer); };
      tx.onabort = tx.onerror = () => { db.close(); reject(new Error("Não foi possível salvar a tentativa com segurança.")); };
      try { work(tx.objectStore("attempts"), value => { answer = value; }); }
      catch { tx.abort(); }
    });
  }
  function checked(value: unknown, actor: string, band?: string): BandDeletionAttempt | null {
    if (value === undefined) return null;
    if (!validDeletionAttempt(value) || value.actorId !== actor || (band && value.bandId !== band)) {
      throw new Error("Registro de tentativa inválido. A exclusão foi bloqueada.");
    }
    return value;
  }
  return {
    read: (actor, band) => transaction("readonly", (store, done) => {
      const r = store.get(key(actor, band));
      r.onsuccess = () => { try { done(checked(r.result, actor, band)); } catch { store.transaction.abort(); } };
    }),
    list: actor => transaction("readonly", (store, done) => {
      const records: BandDeletionAttempt[] = [];
      const r = store.openCursor();
      r.onsuccess = () => {
        const cursor = r.result;
        if (!cursor) { done(records); return; }
        if (String(cursor.key).startsWith(`${prefix}${actor}:`)) {
          try { const value = checked(cursor.value, actor); if (value) records.push(value); }
          catch { store.transaction.abort(); return; }
        }
        cursor.continue();
      };
    }),
    // A readwrite transaction serializes competing tabs. Resolve only on COMMIT,
    // so no RPC can precede durable storage of the operation identifier.
    getOrCreate: (actor, band, confirmation) => transaction("readwrite", (store, done) => {
      const r = store.get(key(actor, band));
      r.onsuccess = () => {
        try {
          const old = checked(r.result, actor, band);
          if (old) { done(old); return; }
          const attempt: BandDeletionAttempt = { version: 1, actorId: actor, bandId: band,
            operationId: randomUUID(), confirmation };
          if (!validDeletionAttempt(attempt)) throw new Error("Invalid attempt");
          store.add(attempt, key(actor, band)); done(attempt);
        } catch { store.transaction.abort(); }
      };
    }),
    remove: attempt => transaction("readwrite", (store, done) => {
      const r = store.get(key(attempt.actorId, attempt.bandId));
      r.onsuccess = () => {
        if (r.result?.operationId === attempt.operationId) store.delete(key(attempt.actorId, attempt.bandId));
        done(undefined);
      };
    }),
  };
}

export function browserBandDeletionAttempts(): BandDeletionAttemptStore {
  return createBandDeletionAttemptStore(window.indexedDB,
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin, () => crypto.randomUUID());
}

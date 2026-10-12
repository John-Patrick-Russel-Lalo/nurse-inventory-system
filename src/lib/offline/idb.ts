// A minimal IndexedDB wrapper. No dependency, and nothing here touches `indexedDB`
// until a function is called, so importing it during server prerender is safe.

export const STORES = {
  items: "items",
  batches: "batches",
  transactions: "transactions",
  meta: "meta",
  outbox: "outbox",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

const DB_NAME = "nurse-inventory";
const DB_VERSION = 1;

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!idbAvailable()) return Promise.reject(new Error("IndexedDB is not available."));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.items)) db.createObjectStore(STORES.items, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.batches)) db.createObjectStore(STORES.batches, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.transactions)) db.createObjectStore(STORES.transactions, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORES.outbox)) db.createObjectStore(STORES.outbox, { keyPath: "clientId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return wrap(db.transaction(store, "readonly").objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function getOne<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return wrap(db.transaction(store, "readonly").objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function put(store: StoreName, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  await done(tx);
}

export async function putMany(store: StoreName, values: readonly unknown[]): Promise<void> {
  if (values.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  const objectStore = tx.objectStore(store);
  for (const value of values) objectStore.put(value);
  await done(tx);
}

export async function del(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await done(tx);
}

/**
 * Removes every row in the store whose key is not in `keep`. This is what lets the mirror
 * drop things the server no longer has (a deleted item, its batches and entries) instead of
 * keeping stale copies forever. The keys are read and the deletes issued inside one
 * transaction, so the store either ends exactly matching `keep` or is left untouched.
 */
export async function deleteKeysExcept(store: StoreName, keep: readonly IDBValidKey[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  const objectStore = tx.objectStore(store);
  const keepSet = new Set(keep);
  const keys = objectStore.getAllKeys();
  keys.onsuccess = () => {
    for (const key of keys.result) {
      if (!keepSet.has(key)) objectStore.delete(key);
    }
  };
  keys.onerror = () => tx.abort();
  await done(tx);
}

export async function clear(store: StoreName): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).clear();
  await done(tx);
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

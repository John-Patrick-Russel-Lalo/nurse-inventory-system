// The browser's mirror of the server's working set, plus the outbox of movements that
// still need to reach it. Everything is a plain record; balances are never stored.

import type {
  OutboxMovement,
  Role,
  SyncBatch,
  SyncItem,
  SyncSnapshot,
  SyncTransaction,
} from "@/lib/api-types";
import { clear, del, getAll, getOne, put, putMany, STORES } from "./idb";

export interface CachedSession {
  user: { id: number; name: string; email: string; role: Role };
  today: string;
  closedMonths: string[];
  nurseBackdateDays: number;
  savedAt: number;
}

export interface SnapshotData {
  items: SyncItem[];
  batches: SyncBatch[];
  transactions: SyncTransaction[];
}

interface MetaRecord<T> {
  key: string;
  value: T;
}

const META = {
  session: "session",
  lastSyncAt: "lastSyncAt",
  hydratedAt: "hydratedAt",
  credential: "credential",
} as const;

async function getMeta<T>(key: string): Promise<T | undefined> {
  const record = await getOne<MetaRecord<T>>(STORES.meta, key);
  return record?.value;
}

async function setMeta<T>(key: string, value: T): Promise<void> {
  await put(STORES.meta, { key, value });
}

export const store = {
  async readSnapshot(): Promise<SnapshotData> {
    const [items, batches, transactions] = await Promise.all([
      getAll<SyncItem>(STORES.items),
      getAll<SyncBatch>(STORES.batches),
      getAll<SyncTransaction>(STORES.transactions),
    ]);
    return { items, batches, transactions };
  },

  async saveSnapshot(snapshot: SyncSnapshot): Promise<void> {
    await putMany(STORES.items, snapshot.items);
    await putMany(STORES.batches, snapshot.batches);
    await putMany(STORES.transactions, snapshot.transactions);
    await this.saveSession({
      user: snapshot.user,
      today: snapshot.today,
      closedMonths: snapshot.closedMonths,
      nurseBackdateDays: snapshot.nurseBackdateDays,
      savedAt: Date.now(),
    });
    await setMeta(META.lastSyncAt, Date.now());
    await setMeta(META.hydratedAt, Date.now());
  },

  async reset(): Promise<void> {
    await Promise.all([
      clear(STORES.items),
      clear(STORES.batches),
      clear(STORES.transactions),
      clear(STORES.meta),
      clear(STORES.outbox),
    ]);
  },

  async getSession(): Promise<CachedSession | undefined> {
    return getMeta<CachedSession>(META.session);
  },

  async saveSession(session: CachedSession): Promise<void> {
    await setMeta(META.session, session);
  },

  async getLastSyncAt(): Promise<number | undefined> {
    return getMeta<number>(META.lastSyncAt);
  },

  async isHydrated(): Promise<boolean> {
    return (await getMeta<number>(META.hydratedAt)) !== undefined;
  },

  // ---------- outbox ----------

  async addOutbox(entry: OutboxMovement): Promise<void> {
    await put(STORES.outbox, entry);
  },

  async listOutbox(): Promise<OutboxMovement[]> {
    const entries = await getAll<OutboxMovement>(STORES.outbox);
    return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async getOutbox(clientId: string): Promise<OutboxMovement | undefined> {
    return getOne<OutboxMovement>(STORES.outbox, clientId);
  },

  async removeOutbox(clientId: string): Promise<void> {
    await del(STORES.outbox, clientId);
  },

  async updateOutbox(entry: OutboxMovement): Promise<void> {
    await put(STORES.outbox, entry);
  },

  // ---------- credential (offline sign-in) ----------

  async getCredential(): Promise<CredentialRecord | undefined> {
    return getMeta<CredentialRecord>(META.credential);
  },

  async saveCredential(record: CredentialRecord): Promise<void> {
    await setMeta(META.credential, record);
  },
};

export interface CredentialRecord {
  email: string;
  salt: string;
  hash: string;
  iterations: number;
  savedAt: number;
}

// Keeps the browser mirror close to the server: replays the movement queue, then pulls a fresh
// snapshot. Owns the online/offline state the UI reads.

import type { MovementResult, OutboxMovement, SyncSnapshot } from "@/lib/api-types";
import { ApiError } from "@/lib/api-error";
import { store } from "./store";

export interface SyncState {
  online: boolean;
  syncing: boolean;
  hydrated: boolean;
  lastSyncAt: number | null;
  pending: number;
  failed: number;
  error: string | null;
}

let state: SyncState = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  syncing: false,
  hydrated: false,
  lastSyncAt: null,
  pending: 0,
  failed: 0,
  error: null,
};

const listeners = new Set<(s: SyncState) => void>();

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(listener: (s: SyncState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function isOnline(): boolean {
  return state.online;
}

async function refreshCounts(): Promise<void> {
  const outbox = await store.listOutbox();
  setState({
    pending: outbox.filter((o) => o.status === "pending").length,
    failed: outbox.filter((o) => o.status === "failed").length,
  });
}

/** The Record screen calls this after queueing a movement so the badge updates at once. */
export async function notifyOutboxChanged(): Promise<void> {
  await refreshCounts();
}

// ---------- pull ----------

export async function pull(): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/sync");
  } catch {
    setState({ online: false });
    throw new ApiError("Could not reach the server.", 0, "OFFLINE");
  }
  if (response.status === 401) throw ApiError.unauthorized();
  if (!response.ok) throw new ApiError(`Sync failed (${response.status}).`, response.status, "SYNC_FAILED");

  const snapshot = (await response.json()) as SyncSnapshot;
  await store.saveSnapshot(snapshot);
  setState({ hydrated: true, lastSyncAt: Date.now(), online: true });
}

// ---------- flush ----------

type PushResult = { ok: true; result: MovementResult } | { ok: false; retry: true } | { ok: false; retry: false; message: string };

async function pushMovement(entry: OutboxMovement): Promise<PushResult> {
  let response: Response;
  try {
    response = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry.body),
    });
  } catch {
    return { ok: false, retry: true };
  }

  if (response.ok) {
    return { ok: true, result: (await response.json()) as MovementResult };
  }
  // Session and server troubles are worth trying again; a refused movement is not.
  if (response.status === 401 || response.status >= 500) return { ok: false, retry: true };

  let message = `The server refused this entry (${response.status}).`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // No JSON body, so the status line is all there is.
  }
  return { ok: false, retry: false, message };
}

export async function flush(): Promise<void> {
  const outbox = await store.listOutbox();
  for (const entry of outbox) {
    if (entry.status === "failed") continue;
    const outcome = await pushMovement(entry);
    if (outcome.ok) {
      await store.removeOutbox(entry.clientId);
    } else if (outcome.retry) {
      setState({ online: false });
      throw new ApiError("Could not reach the server.", 0, "OFFLINE");
    } else {
      await store.updateOutbox({ ...entry, status: "failed", error: outcome.message });
    }
  }
  await refreshCounts();
}

// ---------- orchestration ----------

let syncing: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (syncing) return syncing;
  if (!state.online) return Promise.resolve();

  syncing = (async () => {
    setState({ syncing: true, error: null });
    try {
      await flush();
      await pull();
      setState({ error: null });
    } catch (e) {
      if (e instanceof ApiError && e.code === "OFFLINE") setState({ online: false });
      else setState({ error: e instanceof Error ? e.message : "Sync failed." });
    } finally {
      setState({ syncing: false });
      await refreshCounts();
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** Fired after an online write so the mirror catches the new rows without waiting for the timer. */
export function scheduleSync(): void {
  void syncNow();
}

// ---------- readiness ----------

let ready: Promise<void> | null = null;

/**
 * Makes sure a screen has something to read. First run online downloads the snapshot;
 * offline with nothing stored is a clear error rather than an empty shelf.
 */
export function ensureReady(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (await store.isHydrated()) {
      const last = await store.getLastSyncAt();
      setState({ hydrated: true, lastSyncAt: last ?? null });
      scheduleSync();
      return;
    }
    if (!state.online) {
      throw new ApiError("This device has not downloaded the stock yet. Connect to the internet once to set it up.", 0, "OFFLINE");
    }
    await pull();
    await refreshCounts();
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

// ---------- user actions on a failed entry ----------

export async function retryFailed(clientId: string): Promise<void> {
  const entry = await store.getOutbox(clientId);
  if (!entry) return;
  await store.updateOutbox({ ...entry, status: "pending", error: undefined });
  await notifyOutboxChanged();
  if (state.online) await syncNow();
}

export async function discardFailed(clientId: string): Promise<void> {
  await store.removeOutbox(clientId);
  await notifyOutboxChanged();
}

// ---------- lifecycle ----------

let started = false;

export function startOffline(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  setState({ online: navigator.onLine });

  window.addEventListener("online", () => {
    setState({ online: true });
    void syncNow();
  });
  window.addEventListener("offline", () => setState({ online: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  window.setInterval(() => void syncNow(), 60_000);

  void (async () => {
    await refreshCounts();
    if (await store.isHydrated()) setState({ hydrated: true });
    void syncNow();
  })();
}

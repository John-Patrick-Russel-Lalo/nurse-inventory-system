"use client";

// The typed client every screen uses. Reads are answered from the browser mirror, so a screen
// never waits on the network and works with none. Movements can be recorded offline: they are
// checked with the shared stock rules, shown at once, and queued for the server. Admin-only
// changes and the exports still need a connection, and say so plainly when there is none.

import type {
  AllocateBody,
  AllocationResponse,
  AuditResponse,
  CountsBody,
  DashboardData,
  ExpiryResponse,
  ItemCreateBody,
  ItemDetail,
  ItemPatchBody,
  ItemSummary,
  MonthBody,
  MonthEndResponse,
  MonthsResponse,
  MovementBody,
  MovementResult,
  ReopenBody,
  SessionInfo,
  StockResponse,
  TransactionView,
} from "./api-types";
import type { ImportReportResponse } from "@/server/import-report";
import { ApiError } from "./api-error";
import {
  dashboard as offlineDashboard,
  enqueueMovement,
  expiryReport,
  getItem as offlineGetItem,
  isOnline,
  listItems as offlineListItems,
  listTransactions as offlineListTransactions,
  months as offlineMonths,
  notifyOutboxChanged,
  scheduleSync,
  syncNow,
  stockReport,
  suggestAllocation,
  ensureReady,
  store,
} from "./offline";

export { ApiError };

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(params?: Query): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection.", 0, "OFFLINE");
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const detail = (body ?? {}) as { error?: string; code?: string; fields?: Record<string, string> };
    throw new ApiError(
      detail.error ?? `Request failed (${response.status}).`,
      response.status,
      detail.code ?? "ERROR",
      detail.fields ?? {},
    );
  }
  return body as T;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

/** Things that still need the server. Says so rather than failing silently. */
function requireOnline(feature: string): void {
  if (!isOnline()) {
    throw new ApiError(
      `${feature} needs an internet connection. Stock entries recorded offline are queued and sync automatically.`,
      0,
      "OFFLINE",
    );
  }
}

/** URLs of the routes that answer with a file rather than JSON. */
export const downloadUrls = {
  /** The office's wide "…s" tabs. A month is the day-to-day export; `all` is the whole recorded history. */
  ledger: (q?: { month?: string; from?: string; to?: string; all?: boolean; activeOnly?: boolean }) =>
    `/api/export/ledger${qs(q)}`,
  stock: (q?: Query) => `/api/export/stock${qs(q)}`,
};

/** The filename the server asked for, which knows the range that was actually exported. */
function fileNameFrom(disposition: string | null, fallback: string): string {
  const match = disposition ? /filename="?([^";]+)"?/i.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

/**
 * Downloads a file from an API route. Fetched rather than pointed at by a plain link, so an
 * expired session or a refused range shows the reason on screen instead of quietly saving a JSON
 * error body under an .xlsx name.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  if (!isOnline()) {
    throw new ApiError("Exports need an internet connection. Try again when you are back online.", 0, "OFFLINE");
  }
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    throw new ApiError("Could not reach the server. Check your connection.", 0, "OFFLINE");
  }

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Not a JSON error body, so the status line is all there is to go on.
    }
    throw new ApiError(message, response.status);
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameFrom(response.headers.get("Content-Disposition"), fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Records online through the server, or queues the movement offline. */
async function record(body: MovementBody): Promise<MovementResult> {
  if (!isOnline()) {
    const result = await enqueueMovement(body);
    await notifyOutboxChanged();
    return result;
  }
  try {
    const result = await post<MovementResult>("/api/transactions", body);
    scheduleSync();
    return result;
  } catch (e) {
    if (e instanceof ApiError && e.code === "OFFLINE") {
      const result = await enqueueMovement(body);
      await notifyOutboxChanged();
      return result;
    }
    throw e;
  }
}

export const api = {
  session: async (): Promise<SessionInfo> => {
    await ensureReady();
    const cached = await store.getSession();
    if (!cached) throw ApiError.unauthorized();
    return {
      user: cached.user,
      today: cached.today,
      closedMonths: cached.closedMonths,
      nurseBackdateDays: cached.nurseBackdateDays,
    };
  },
  dashboard: (): Promise<DashboardData> => offlineDashboard(),

  stock: (q?: Query): Promise<StockResponse> =>
    stockReport({
      q: q?.q as string | undefined,
      category: q?.category as string | undefined,
      includeInactive: q?.includeInactive as boolean | undefined,
      lowOnly: q?.lowOnly as boolean | undefined,
    }),
  expiry: (q?: Query): Promise<ExpiryResponse> =>
    expiryReport({
      q: q?.q as string | undefined,
      category: q?.category as string | undefined,
      includeInactive: q?.includeInactive as boolean | undefined,
      lowOnly: q?.lowOnly as boolean | undefined,
    }),

  items: async (q?: Query): Promise<{ items: ItemSummary[] }> => ({
    items: await offlineListItems({
      q: q?.q as string | undefined,
      category: q?.category as string | undefined,
      includeInactive: q?.includeInactive as boolean | undefined,
      lowOnly: q?.lowOnly as boolean | undefined,
    }),
  }),
  item: (id: string): Promise<ItemDetail> => offlineGetItem(id),
  createItem: async (body: ItemCreateBody): Promise<{ item: ItemSummary }> => {
    requireOnline("Adding an item");
    const result = await post<{ item: ItemSummary }>("/api/items", body);
    scheduleSync();
    return result;
  },
  patchItem: async (id: string, body: ItemPatchBody): Promise<{ item: ItemSummary }> => {
    requireOnline("Editing an item");
    const result = await request<{ item: ItemSummary }>(`/api/items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    scheduleSync();
    return result;
  },
  /** Deletes an item and all its history. Admin only. */
  deleteItem: async (id: string): Promise<void> => {
    requireOnline("Deleting an item");
    await request(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
    // Pull the fresh snapshot now so this device's mirror (and therefore the item list) drops
    // the item before the screen that triggered the delete moves on. Mirrors on other devices
    // pick the deletion up the next time they sync.
    try {
      await syncNow();
    } catch {
      // The delete is done server-side either way; a failed pull only delays the local tidying.
    }
  },

  transactions: (q?: Query): Promise<{ transactions: TransactionView[]; total: number }> =>
    offlineListTransactions({
      itemId: q?.itemId as string | undefined,
      from: q?.from as string | undefined,
      to: q?.to as string | undefined,
      type: q?.type as string | undefined,
      includeVoided: q?.includeVoided as boolean | undefined,
      limit: q?.limit as number | undefined,
      offset: q?.offset as number | undefined,
    }),

  /** How the server would split this quantity, earliest expiry first. */
  allocate: (body: AllocateBody): Promise<AllocationResponse> => suggestAllocation(body.itemId, body.qty),
  record,
  voidEntry: async (id: number, reason: string): Promise<{ transaction: TransactionView }> => {
    requireOnline("Voiding an entry");
    const result = await post<{ transaction: TransactionView }>(`/api/transactions/${id}/void`, { reason });
    scheduleSync();
    return result;
  },

  months: (): Promise<MonthsResponse> => offlineMonths(),
  monthEnd: (month?: string): Promise<MonthEndResponse> => {
    requireOnline("The month-end count");
    return request<MonthEndResponse>(`/api/month-end${qs({ month })}`);
  },
  saveCounts: (body: CountsBody): Promise<MonthEndResponse> => {
    requireOnline("Saving counts");
    return post<MonthEndResponse>("/api/month-end", body);
  },
  closeMonth: (body: MonthBody): Promise<MonthEndResponse> => {
    requireOnline("Closing a month");
    return post<MonthEndResponse>("/api/month-end/close", body);
  },
  reopenMonth: (body: ReopenBody): Promise<MonthEndResponse> => {
    requireOnline("Reopening a month");
    return post<MonthEndResponse>("/api/month-end/reopen", body);
  },

  audit: (q?: Query): Promise<AuditResponse> => {
    requireOnline("The audit log");
    return request<AuditResponse>(`/api/audit${qs(q)}`);
  },
  /** What the workbook import brought in, as the import script recorded it. Admin only. */
  importReport: (): Promise<ImportReportResponse> => {
    requireOnline("The import report");
    return request<ImportReportResponse>("/api/import");
  },
};

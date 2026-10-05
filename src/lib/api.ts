"use client";

// Typed wrapper around the API in src/app/api. Every screen reads and writes through here,
// so the browser never talks to Prisma directly and the server stays the only place that
// enforces the stock rules.

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

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;

  constructor(message: string, status: number, code = "ERROR", fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** True when the session is gone, so the caller should send the person to the login form. */
  get isAuth(): boolean {
    return this.status === 401;
  }
}

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

export const api = {
  session: () => request<SessionInfo>("/api/session"),
  dashboard: () => request<DashboardData>("/api/dashboard"),

  stock: (q?: Query) => request<StockResponse>(`/api/stock${qs(q)}`),
  expiry: (q?: Query) => request<ExpiryResponse>(`/api/expiry${qs(q)}`),

  items: (q?: Query) => request<{ items: ItemSummary[] }>(`/api/items${qs(q)}`),
  item: (id: string) => request<ItemDetail>(`/api/items/${encodeURIComponent(id)}`),
  createItem: (body: ItemCreateBody) => post<{ item: ItemSummary }>("/api/items", body),
  patchItem: (id: string, body: ItemPatchBody) =>
    request<{ item: ItemSummary }>(`/api/items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  transactions: (q?: Query) =>
    request<{ transactions: TransactionView[]; total: number }>(`/api/transactions${qs(q)}`),

  /** How the server would split this quantity, earliest expiry first. */
  allocate: (body: AllocateBody) => post<AllocationResponse>("/api/transactions/allocate", body),
  record: (body: MovementBody) => post<MovementResult>("/api/transactions", body),
  voidEntry: (id: number, reason: string) =>
    post<{ transaction: TransactionView }>(`/api/transactions/${id}/void`, { reason }),

  months: () => request<MonthsResponse>("/api/months"),
  monthEnd: (month?: string) => request<MonthEndResponse>(`/api/month-end${qs({ month })}`),
  saveCounts: (body: CountsBody) => post<MonthEndResponse>("/api/month-end", body),
  closeMonth: (body: MonthBody) => post<MonthEndResponse>("/api/month-end/close", body),
  reopenMonth: (body: ReopenBody) => post<MonthEndResponse>("/api/month-end/reopen", body),

  audit: (q?: Query) => request<AuditResponse>(`/api/audit${qs(q)}`),
  /** What the workbook import brought in, as the import script recorded it. Admin only. */
  importReport: () => request<ImportReportResponse>("/api/import"),
};

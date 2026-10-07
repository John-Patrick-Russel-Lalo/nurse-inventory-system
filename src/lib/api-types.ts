// The shape of every API response. Imported by both the server (route handlers) and the
// frontend (fetch client), so a change here breaks typecheck on both sides at once.

export type Role = "NURSE" | "ADMIN";

export const CATEGORIES = ["MEDICINE", "SUPPLY", "EQUIPMENT", "TOPICAL", "SOLUTION", "MISC"] as const;
export type Category = (typeof CATEGORIES)[number];

export const TX_TYPES = ["OPENING", "RECEIVE", "DISPENSE", "ADJUST", "DISPOSE"] as const;
export type TxType = (typeof TX_TYPES)[number];

export type ExpiryStatus = "NO_EXPIRY" | "EXPIRED" | "DAYS_30" | "DAYS_60" | "DAYS_90" | "OK";

export interface SessionInfo {
  user: { id: number; name: string; email: string; role: Role };
  /** Today in Asia/Manila as "YYYY-MM-DD". The whole app reasons in this format. */
  today: string;
  /** Months that are closed, as "YYYY-MM". */
  closedMonths: string[];
  /** How many days back a nurse may still record. */
  nurseBackdateDays: number;
}

export interface BatchView {
  id: number;
  expiry: string | null;
  label: string | null;
  source: string | null;
  receivedOn: string | null;
  qtyReceived: number;
  balance: number;
  expiryStatus: ExpiryStatus;
  daysToExpiry: number | null;
}

export interface ItemSummary {
  id: string;
  name: string;
  variant: string | null;
  category: Category;
  unit: string | null;
  reorderLevel: number | null;
  active: boolean;
  balance: number;
  lowStock: boolean;
  nearestExpiry: string | null;
  expiredQty: number;
  batchCount: number;
}

export interface TransactionView {
  id: number;
  date: string;
  itemId: string;
  itemName: string;
  batchId: number;
  batchExpiry: string | null;
  batchLabel: string | null;
  type: TxType;
  qty: number;
  source: string | null;
  remarks: string | null;
  userName: string;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
}

export interface ItemDetail {
  item: Omit<ItemSummary, "balance" | "lowStock" | "nearestExpiry" | "expiredQty" | "batchCount">;
  balance: number;
  lowStock: boolean;
  batches: BatchView[];
  transactions: TransactionView[];
  /** Received and dispensed per month, oldest first, over the item's whole life. */
  monthly: MonthUsage[];
  /** The balance at each month end, same months as `monthly`. */
  balances: MonthBalance[];
}

export interface StockRow {
  item: ItemSummary;
  batches: BatchView[];
}

export interface StockResponse {
  rows: StockRow[];
  total: { items: number; units: number; lowStock: number; expired: number };
}

export interface AllocationLine {
  batchId: number;
  qty: number;
  expiry: string | null;
  label: string | null;
  balance: number;
}

export interface AllocationResponse {
  allocations: AllocationLine[];
  usable: number;
  requested: number;
}

export interface ExpiryRow {
  itemId: string;
  itemName: string;
  variant: string | null;
  unit: string | null;
  batchId: number;
  batchLabel: string | null;
  expiry: string;
  daysToExpiry: number;
  status: ExpiryStatus;
  balance: number;
}

export interface ExpiryResponse {
  today: string;
  expired: ExpiryRow[];
  buckets: Record<"DAYS_30" | "DAYS_60" | "DAYS_90", ExpiryRow[]>;
  totalUnits: number;
}

export interface ClosedMonth {
  month: string;
  closedAt: string;
  closedByName: string;
}

export interface MonthsResponse {
  today: string;
  closed: ClosedMonth[];
  /** The most recent month that can be closed, as "YYYY-MM". */
  suggest: string;
}

export interface CountRow {
  itemId: string;
  itemName: string;
  variant: string | null;
  unit: string | null;
  category: Category;
  system: number;
  counted: number | null;
  difference: number | null;
}

export interface MonthEndResponse {
  month: string;
  closed: boolean;
  closedAt: string | null;
  counts: CountRow[];
  summary: { items: number; counted: number; varianceUnits: number };
}

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  entity: string;
  entityId: string;
  detail: unknown;
  userName: string | null;
}

export interface AuditResponse {
  entries: AuditEntry[];
  total: number;
}

export interface ExpiringBatch {
  itemId: string;
  itemName: string;
  expiry: string;
  balance: number;
  daysLeft: number;
}

/** One month of movement. An entry counts by the direction it moved the stock, so received
 *  minus dispensed is always the change in stock. */
export interface MonthUsage {
  /** "YYYY-MM". */
  month: string;
  received: number;
  dispensed: number;
}

/** What an item held at the end of a month. */
export interface MonthBalance {
  month: string;
  balance: number;
}

/** An item, and how much of it the office used in a month. */
export interface TopUsedItem {
  itemId: string;
  itemName: string;
  dispensed: number;
}

export interface DashboardData {
  itemCount: number;
  lowStock: ItemSummary[];
  expiringSoon: ExpiringBatch[];
  expired: { itemId: string; itemName: string; balance: number }[];
  /** The last twelve months, oldest first. The final entry is the month in progress. */
  monthTotals: MonthUsage[];
  /** What the office used most in the month in progress. */
  topUsed: TopUsedItem[];
  recent: TransactionView[];
}

// ---------- request bodies ----------

export type MovementBody =
  | {
      type: "OPENING" | "RECEIVE";
      itemId: string;
      qty: number;
      date?: string;
      expiry?: string | null;
      lot?: string | null;
      source?: string | null;
      remarks?: string | null;
    }
  | {
      type: "DISPENSE" | "DISPOSE";
      itemId: string;
      qty: number;
      date?: string;
      source?: string | null;
      remarks?: string | null;
      /** Omit to let the server split earliest-expiry-first. */
      allocations?: { batchId: number; qty: number }[];
    }
  | {
      type: "ADJUST";
      itemId: string;
      qty: number;
      batchId: number;
      date?: string;
      source?: string | null;
      remarks?: string | null;
    };

export interface MovementResult {
  transactions: TransactionView[];
  /** For DISPENSE/DISPOSE: how the quantity was split across batches. */
  allocations?: AllocationLine[];
  balances: Record<string, number>;
}

export interface VoidBody {
  reason: string;
}

export interface ItemPatchBody {
  name?: string;
  variant?: string | null;
  category?: Category;
  unit?: string | null;
  reorderLevel?: number | null;
  active?: boolean;
}

export interface ItemCreateBody {
  id?: string;
  name: string;
  variant?: string | null;
  category: Category;
  unit?: string | null;
  reorderLevel?: number | null;
}

export interface AllocateBody {
  itemId: string;
  qty: number;
  date?: string;
}

export interface CountsBody {
  month: string;
  counts: { itemId: string; counted: number }[];
}

export interface MonthBody {
  month: string;
}

export interface ReopenBody {
  month: string;
  reason: string;
}

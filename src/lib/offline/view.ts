// Combines the mirrored server rows with the movements still waiting in the outbox, so a
// screen shows what the office recorded even before the server has heard about it.
//
// Nothing is written here: the queued movements are applied on every read, against the same
// earliest-expiry-first rules the server uses. A movement the server already rejected (failed)
// is left out of the balances and surfaced separately.

import type { OutboxMovement, SyncBatch, SyncItem, SyncTransaction, TxType } from "@/lib/api-types";
import { allocateFefo, expiryStatus, isExpired, signedQty, type BatchStock } from "@/lib/stock";
import { parseExpiry } from "@/lib/stock";
import type { CachedSession, SnapshotData } from "./store";

export interface ViewBatch extends SyncBatch {
  pending?: boolean;
}

export interface ViewTx extends SyncTransaction {
  pending?: boolean;
}

export interface View {
  items: SyncItem[];
  batches: ViewBatch[];
  transactions: ViewTx[];
  today: string;
}

export function buildView(
  base: SnapshotData,
  outbox: readonly OutboxMovement[],
  session: CachedSession | undefined,
): View {
  const items = base.items.slice();
  const batches: ViewBatch[] = base.batches.map((b) => ({ ...b }));
  const transactions: ViewTx[] = base.transactions.map((t) => ({ ...t }));

  const balances = new Map<number, number>();
  for (const t of transactions) {
    if (t.voidedAt) continue;
    balances.set(t.batchId, (balances.get(t.batchId) ?? 0) + t.qty);
  }

  const today = session?.today ?? "";
  let tempId = -1;

  for (const entry of outbox) {
    if (entry.status === "failed") continue;
    const { body } = entry;
    const date = body.date ?? today;
    const userName = entry.userName;

    let signed: number;
    try {
      signed = signedQty(body.type as TxType, body.qty);
    } catch {
      continue;
    }

    if (body.type === "OPENING" || body.type === "RECEIVE") {
      const expiry = body.expiry ? parseExpiry(body.expiry) : null;
      let batch = batches.find((b) => b.itemId === body.itemId && b.expiry === expiry);
      if (!batch) {
        batch = {
          id: tempId--,
          itemId: body.itemId,
          expiry,
          label: body.lot?.trim() || null,
          source: body.source?.trim() || null,
          receivedOn: date,
          qtyReceived: body.qty,
          pending: true,
        };
        batches.push(batch);
        balances.set(batch.id, 0);
      }
      transactions.push(makeTx(tempId--, entry.clientId, date, body.itemId, batch.id, body.type, signed, body.source, body.remarks, userName));
      balances.set(batch.id, (balances.get(batch.id) ?? 0) + signed);
    } else if (body.type === "DISPENSE" || body.type === "DISPOSE") {
      const magnitude = Math.abs(signed);
      const stock: BatchStock[] = batches
        .filter((b) => b.itemId === body.itemId)
        .map((b) => ({ batchId: b.id, expiry: b.expiry, balance: balances.get(b.id) ?? 0 }));
      let split: { batchId: number; qty: number }[];
      if (body.allocations?.length) {
        split = body.allocations;
      } else {
        try {
          split = allocateFefo(stock, magnitude, today);
        } catch {
          continue;
        }
      }
      for (const line of split) {
        transactions.push(makeTx(tempId--, entry.clientId, date, body.itemId, line.batchId, body.type, -line.qty, body.source, body.remarks, userName));
        balances.set(line.batchId, (balances.get(line.batchId) ?? 0) - line.qty);
      }
    } else if (body.type === "ADJUST") {
      if (!batches.some((b) => b.id === body.batchId && b.itemId === body.itemId)) continue;
      transactions.push(makeTx(tempId--, entry.clientId, date, body.itemId, body.batchId, body.type, signed, body.source, body.remarks, userName));
      balances.set(body.batchId, (balances.get(body.batchId) ?? 0) + signed);
    }
  }

  return { items, batches, transactions, today };
}

function makeTx(
  id: number,
  clientId: string,
  date: string,
  itemId: string,
  batchId: number,
  type: TxType,
  qty: number,
  source: string | null | undefined,
  remarks: string | null | undefined,
  userName: string,
): ViewTx {
  return {
    id,
    clientId,
    date,
    itemId,
    batchId,
    type,
    qty,
    source: source ?? null,
    remarks: remarks ?? null,
    userName,
    voidedAt: null,
    voidReason: null,
    pending: true,
  };
}

/** Balance per batch for the given rows. Voided and pending both count unless voided. */
export function balancesOf(transactions: readonly ViewTx[]): Map<number, number> {
  const balances = new Map<number, number>();
  for (const t of transactions) {
    if (t.voidedAt) continue;
    balances.set(t.batchId, (balances.get(t.batchId) ?? 0) + t.qty);
  }
  return balances;
}

export { expiryStatus, isExpired };

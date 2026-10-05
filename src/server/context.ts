import { db } from "@/lib/db";
import { isDateString, isMonthString, today } from "@/lib/dates";
import type { Role } from "@/lib/stock";
import { ApiError } from "./http";

/** As `assertDateString`, but a bad value is the caller's fault, so it answers 400 not 500. */
export function serverDate(value: string, label = "date"): string {
  if (!isDateString(value)) throw ApiError.badRequest(`${label} "${value}" is not a real date.`);
  return value;
}

/** As `assertMonthString`, but a bad value answers 400. */
export function serverMonth(value: string): string {
  if (!isMonthString(value)) throw ApiError.badRequest(`month "${value}" must look like "2026-09".`);
  return value;
}

/** How many days back a nurse may still record. Admins have no limit. */
export const NURSE_BACKDATE_DAYS = Number(process.env.NURSE_BACKDATE_DAYS ?? 3);

export interface Ctx {
  user: { id: number; name: string; email: string; role: Role };
  /** Today in the office's time zone, as "YYYY-MM-DD". */
  today: string;
  /** Months that are closed, as "YYYY-MM". Entries dated inside one are refused. */
  closed: ReadonlySet<string>;
}

/**
 * The signed-in user plus the date context every write needs. Throws 401 when there is no
 * session, which is what an API route wants (the page-level helpers redirect instead).
 *
 * The session is imported lazily so a page that only needs a date helper never pulls
 * bcrypt and Prisma into its module graph.
 */
export async function context(): Promise<Ctx> {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!session?.user) throw ApiError.unauthorized();

  const closed = new Set((await db.closedMonth.findMany({ select: { month: true } })).map((m) => m.month));
  return {
    user: {
      id: Number(session.user.id),
      name: session.user.name ?? "",
      email: session.user.email ?? "",
      role: session.user.role,
    },
    today: today(),
    closed,
  };
}

/** Context plus a role check, for the admin-only writes. */
export async function adminContext(): Promise<Ctx> {
  const ctx = await context();
  if (ctx.user.role !== "ADMIN") throw ApiError.forbidden("Only an admin can do this.");
  return ctx;
}

/** The client a `$transaction` callback receives: every model, none of the lifecycle methods. */
export type TxClient = Omit<typeof db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

/**
 * Records an audit entry. Takes a client so it can join an open transaction, which is what
 * every stock change does: a change and its audit note commit together or not at all.
 */
export async function audit(
  client: TxClient,
  ctx: Ctx,
  action: string,
  entity: string,
  entityId: string,
  detail?: unknown,
): Promise<void> {
  await client.auditLog.create({
    data: {
      userId: ctx.user.id,
      action,
      entity,
      entityId,
      detail: detail === undefined ? undefined : (detail as object),
    },
  });
}

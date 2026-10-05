// Date helpers shared by the server, the pages and the client components.
//
// The office is in Asia/Manila and every date in this app is a "YYYY-MM-DD" string, so the
// time zone can never slide an entry into the neighbouring day. Prisma's @db.Date columns
// come back as UTC midnight, and these two functions convert without drifting.

const MANILA = "Asia/Manila";

/** Today in the office's time zone, as "YYYY-MM-DD". */
export function today(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isDateString = (value: string): boolean =>
  DATE_RE.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

export const isMonthString = (value: string): boolean => MONTH_RE.test(value);

/** "YYYY-MM-DD" to the value Prisma expects for a @db.Date column. */
export function toDbDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** A @db.Date column back to a "YYYY-MM-DD" string. */
export function fromDbDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Shifts a "YYYY-MM-DD" date by whole days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The "YYYY-MM" month of a date. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** The last day of a month, as "YYYY-MM-DD". */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The month before the given one, as "YYYY-MM". */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

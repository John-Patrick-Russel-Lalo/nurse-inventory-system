import { z } from "zod";
import { CATEGORIES, TX_TYPES } from "@/lib/api-types";

const category = z.enum(CATEGORIES);
const txType = z.enum(TX_TYPES);

const text = (max: number) => z.string().trim().max(max).nullish();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional();

/** Everything a movement shares. */
const base = {
  itemId: z.string().trim().min(1, "Choose an item.").max(20),
  qty: z.number().int("Whole numbers only."),
  date,
  source: text(120),
  remarks: text(500),
};

const allocations = z
  .array(z.object({ batchId: z.number().int().positive(), qty: z.number().int().positive() }))
  .max(50)
  .optional();

/**
 * A movement is one of five things, and each needs a different set of extra fields.
 * The stock rules (src/lib/stock.ts) still have the final say on signs and feasibility.
 */
export const movementSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("OPENING"), ...base, expiry: text(20), lot: text(80) }),
  z.object({ type: z.literal("RECEIVE"), ...base, expiry: text(20), lot: text(80) }),
  z.object({ type: z.literal("DISPENSE"), ...base, allocations }),
  z.object({ type: z.literal("DISPOSE"), ...base, allocations }),
  z.object({ type: z.literal("ADJUST"), ...base, batchId: z.number().int().positive() }),
]);
export const allocateSchema = z.object({
  itemId: z.string().trim().min(1).max(20),
  qty: z.number().int().positive("Enter a quantity above zero."),
  date,
});

export const voidSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason for the void.").max(300),
});

export const itemPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    variant: z.string().trim().max(120).nullish(),
    category: category.optional(),
    unit: z.string().trim().max(30).nullish(),
    reorderLevel: z.number().int().min(0).nullish(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });

export const itemCreateSchema = z.object({
  id: z.string().trim().max(20).optional(),
  name: z.string().trim().min(2, "Give the item a name.").max(120),
  variant: z.string().trim().max(120).nullish(),
  category,
  unit: z.string().trim().max(30).nullish(),
  reorderLevel: z.number().int().min(0).nullish(),
});

export const monthSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use "2026-09".'),
});

export const reopenSchema = monthSchema.extend({
  reason: z.string().trim().min(3, "Give a reason for reopening.").max(300),
});

export const countsSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use "2026-09".'),
  counts: z
    .array(z.object({ itemId: z.string().trim().min(1).max(20), counted: z.number().int().min(0) }))
    .min(1, "Enter at least one count.")
    .max(1000),
});

/** Accepts "1", "on" and "true" so a plain HTML form checkbox works. */
const flag = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v === "1" || v === "true" || v === "on"));

export const stockQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(20).optional(),
  includeInactive: flag.optional(),
  lowOnly: flag.optional(),
});

export const txQuerySchema = z.object({
  itemId: z.string().trim().max(20).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.union([z.literal("ALL"), txType]).optional(),
  includeVoided: flag.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const auditQuerySchema = z.object({
  action: z.string().trim().max(40).optional(),
  entity: z.string().trim().max(20).optional(),
  entityId: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

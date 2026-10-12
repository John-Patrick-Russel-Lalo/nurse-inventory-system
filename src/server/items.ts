import { db } from "@/lib/db";
import type { Category, ItemCreateBody, ItemPatchBody, ItemSummary } from "@/lib/api-types";
import { CATEGORY_PREFIX, formatItemId } from "@/lib/api-types";
import { audit, type Ctx } from "./context";
import { ApiError } from "./http";
import { listItems } from "./inventory";

/** Adds an item to the catalogue. Admin only. The ID is the category's next free number. */
export async function createItem(ctx: Ctx, body: ItemCreateBody): Promise<ItemSummary> {
  if (ctx.user.role !== "ADMIN") throw ApiError.forbidden("Only an admin can add an item.");

  const name = body.name.trim();
  if (name.length < 2) throw ApiError.badRequest("Give the item a name.");

  const id = await nextItemId(body.category);
  if (await db.item.findUnique({ where: { id } })) throw ApiError.conflict(`Item "${id}" already exists.`);

  await db.$transaction(async (tx) => {
    await tx.item.create({
      data: {
        id,
        name,
        variant: body.variant?.trim() || null,
        category: body.category,
        unit: body.unit?.trim() || null,
        reorderLevel: normaliseLevel(body.reorderLevel),
      },
    });
    await audit(tx, ctx, "item.create", "item", id, { name, category: body.category });
  });

  const created = (await listItems(ctx, { includeInactive: true })).find((i) => i.id === id);
  if (!created) throw new Error(`Item ${id} vanished right after being created.`);
  return created;
}

function normaliseLevel(value: number | null | undefined): number | null {
  if (value === null || value === undefined || value === 0) return null;
  if (!Number.isInteger(value) || value < 0) throw ApiError.badRequest("Reorder level must be zero or more.");
  return value;
}

/**
 * Edits an item's descriptive fields. `unit` and `reorderLevel` are what Phase 2 data cleanup
 * fills in, so they are ordinary fields here rather than a one-off script.
 */
export async function updateItem(ctx: Ctx, id: string, patch: ItemPatchBody): Promise<ItemSummary> {
  if (ctx.user.role !== "ADMIN") throw ApiError.forbidden("Only an admin can edit an item.");

  const before = await db.item.findUnique({ where: { id } });
  if (!before) throw ApiError.notFound(`No item with ID "${id}".`);

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 2) throw ApiError.badRequest("Give the item a name.");
    data.name = name;
  }
  if (patch.variant !== undefined) data.variant = patch.variant?.trim() || null;
  if (patch.category !== undefined) data.category = patch.category;
  if (patch.unit !== undefined) data.unit = patch.unit?.trim() || null;
  if (patch.reorderLevel !== undefined) data.reorderLevel = normaliseLevel(patch.reorderLevel);
  if (patch.active !== undefined) data.active = patch.active;

  if (Object.keys(data).length === 0) throw ApiError.badRequest("Nothing to change.");

  await db.$transaction(async (tx) => {
    await tx.item.update({ where: { id }, data });
    await audit(tx, ctx, "item.update", "item", id, {
      before: { name: before.name, variant: before.variant, category: before.category, unit: before.unit, reorderLevel: before.reorderLevel, active: before.active },
      after: data,
    });
  });

  const updated = (await listItems(ctx, { includeInactive: true })).find((i) => i.id === id);
  if (!updated) throw new Error(`Item ${id} vanished right after being updated.`);
  return updated;
}

/**
 * Deletes an item and everything that belongs to it. Admin only.
 *
 * Stock is never deleted under the covers anywhere else, but a stale item has no place in the
 * catalogue, so this removes the item, its batches and every entry against them, and its month
 * counts, all in one transaction. The audit log keeps the name, so a deletion is never silent.
 */
export async function deleteItem(ctx: Ctx, id: string): Promise<void> {
  if (ctx.user.role !== "ADMIN") throw ApiError.forbidden("Only an admin can delete an item.");

  const gone = await db.item.findUnique({ where: { id }, select: { id: true, name: true, category: true } });
  if (!gone) throw ApiError.notFound(`No item with ID "${id}".`);

  await db.$transaction(async (tx) => {
    // Children first: batches and counts hold foreign keys back to the item, and the entries
    // hold keys to the batches, so they have to go in reverse order of the references.
    await tx.transaction.deleteMany({ where: { itemId: id } });
    await tx.batch.deleteMany({ where: { itemId: id } });
    await tx.monthClosing.deleteMany({ where: { itemId: id } });
    await tx.item.delete({ where: { id } });
    await audit(tx, ctx, "item.delete", "item", id, { name: gone.name, category: gone.category });
  });
}

/** The next free ID in a category's block, e.g. MED-152 for the MEDICINE category. */
async function nextItemId(category: Category): Promise<string> {
  const prefix = CATEGORY_PREFIX[category];
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  const rows = await db.item.findMany({
    where: { id: { startsWith: `${prefix}-` } },
    select: { id: true },
  });
  for (const row of rows) {
    const m = re.exec(row.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return formatItemId(category, max + 1);
}

import { db } from "@/lib/db";
import type { ItemCreateBody, ItemPatchBody, ItemSummary } from "@/lib/api-types";
import { audit, type Ctx } from "./context";
import { ApiError } from "./http";
import { listItems } from "./inventory";

const ID_RE = /^[A-Z]{3}-\d{3}$/;

/** Adds an item to the catalogue. Admin only. */
export async function createItem(ctx: Ctx, body: ItemCreateBody): Promise<ItemSummary> {
  if (ctx.user.role !== "ADMIN") throw ApiError.forbidden("Only an admin can add an item.");

  const name = body.name.trim();
  if (name.length < 2) throw ApiError.badRequest("Give the item a name.");

  // Ids are the workbook's, so keep the shape unless one was given explicitly.
  const id = (body.id?.trim().toUpperCase() ?? (await nextItemId())).trim();
  if (!ID_RE.test(id)) throw ApiError.badRequest('Item IDs look like "MED-152".');
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

/** The next free ID in the same block as the existing ones, e.g. MED-152. */
async function nextItemId(): Promise<string> {
  const last = await db.item.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
  const match = /^([A-Z]+)-(\d+)$/.exec(last?.id ?? "MED-000");
  const prefix = match ? match[1] : "MED";
  const next = match ? Number(match[2]) + 1 : 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

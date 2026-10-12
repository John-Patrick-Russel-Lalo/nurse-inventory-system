"use client";

import { useEffect, useState } from "react";
import { Button, cn } from "./ui";

/**
 * The pager used under every table: the range on this page, the page number, and Back/Next.
 * `page` is zero-based, so the first page is 0. Render it below a table whenever the data can
 * be longer than a screen.
 */
export function Pagination({
  total,
  page,
  pageSize,
  onPage,
  className,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  if (total === 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const end = Math.min(start + pageSize, total);
  return (
    <div className={cn("mt-3 flex flex-wrap items-center justify-between gap-3", className)}>
      <p className="text-sm text-muted">
        Showing {start + 1}–{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="plain"
          size="md"
          onClick={() => onPage(safePage - 1)}
          disabled={safePage === 0}
        >
          ← Back
        </Button>
        <span className="text-sm text-muted">
          Page {safePage + 1} of {pageCount}
        </span>
        <Button
          type="button"
          variant="plain"
          size="md"
          onClick={() => onPage(safePage + 1)}
          disabled={safePage >= pageCount - 1}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}

/**
 * Slices a list into pages of `pageSize` for the Pagination above. Pass a `resetKey` that
 * changes whenever the filters change so the pager lands back on the first page.
 */
export function usePaging<T>(rows: readonly T[], pageSize = 10, resetKey?: unknown) {
  const total = rows.length;
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [resetKey]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  return {
    page: safePage,
    setPage,
    start,
    pageCount,
    pageSize,
    rows: rows.slice(start, start + pageSize),
  };
}
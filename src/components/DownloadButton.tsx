"use client";

import { useState } from "react";
import { downloadFile } from "@/lib/api";
import { Button, IconDownload } from "./ui";

/**
 * A button that downloads a file from an API route.
 *
 * Fetched rather than linked to, so a refused range or an expired session reports why on screen
 * instead of saving an error body as a spreadsheet. The filename the server chose wins, so a
 * ledger download is named for the month that was actually exported.
 */
export function DownloadButton({
  url,
  fallbackName,
  children,
  variant = "plain",
  size = "sm",
  className,
  disabled,
}: {
  url: string;
  /** Used only if the response carries no Content-Disposition. */
  fallbackName: string;
  children: React.ReactNode;
  variant?: "primary" | "plain" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await downloadFile(url, fallbackName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The download failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex flex-col gap-1">
      <Button
        variant={variant}
        size={size}
        onClick={() => void run()}
        disabled={busy || disabled}
        className={className}
      >
        {busy ? "Preparing…" : <><IconDownload />{children}</>}
      </Button>
      {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
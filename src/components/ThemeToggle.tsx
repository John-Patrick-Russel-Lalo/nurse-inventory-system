"use client";

import { MODES, useTheme } from "./ThemeProvider";
import { cn } from "./ui";

/**
 * A quick light / dark / auto switch. The full set of colour themes lives on the Settings
 * screen; this stays small because it sits in the sidebar of every page.
 */
export function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div
      className="flex items-center gap-0.5 rounded-xl border border-rule bg-surface p-0.5 shadow-card"
      role="group"
      aria-label="Light or dark"
    >
      {MODES.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={mode === option.value}
          onClick={() => setMode(option.value)}
          className={cn(
            "cursor-pointer rounded-lg px-2.5 py-1 text-xs transition-[background-color,color,box-shadow] duration-150",
            mode === option.value
              ? "bg-accent-soft font-semibold text-accent shadow-card"
              : "text-muted hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

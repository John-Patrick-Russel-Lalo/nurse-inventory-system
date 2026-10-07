"use client";

import { useEffect, useState } from "react";
import { cn } from "./ui";

type Theme = "light" | "dark" | "system";

const ORDER: Theme[] = ["system", "light", "dark"];
const LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };

/**
 * Light, dark, or follow the system. globals.css already reads `data-theme` on <html>, so
 * this only has to set that attribute and remember the choice.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") setTheme(stored);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = theme;
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  return (
    <div
      className="flex items-center gap-0.5 rounded-xl border border-rule bg-surface p-0.5 shadow-card"
      role="group"
      aria-label="Colour theme"
    >
      {ORDER.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={theme === option}
          onClick={() => setTheme(option)}
          className={cn(
            "cursor-pointer rounded-lg px-2.5 py-1 text-xs transition-[background-color,color,box-shadow] duration-150",
            theme === option
              ? "bg-accent-soft font-semibold text-accent shadow-card"
              : "text-muted hover:text-fg",
          )}
        >
          {LABEL[option]}
        </button>
      ))}
    </div>
  );
}
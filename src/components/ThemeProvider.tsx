"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ThemeColor = "teal" | "ocean" | "violet" | "rose" | "slate";

export const MODES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// The swatch is the light-mode accent, so the picker shows the colour each theme is built around.
export const COLORS: { value: ThemeColor; label: string; swatch: string }[] = [
  { value: "teal", label: "Teal", swatch: "#0b6b63" },
  { value: "ocean", label: "Ocean", swatch: "#1d5fa8" },
  { value: "violet", label: "Violet", swatch: "#6a3fb8" },
  { value: "rose", label: "Rose", swatch: "#b03a55" },
  { value: "slate", label: "Slate", swatch: "#3d4a5c" },
];

const MODE_KEY = "theme";
const COLOR_KEY = "theme-color";

interface ThemeValue {
  mode: ThemeMode;
  color: ThemeColor;
  setMode: (mode: ThemeMode) => void;
  setColor: (color: ThemeColor) => void;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

function isMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isColor(value: string | null): value is ThemeColor {
  return COLORS.some((c) => c.value === value);
}

/**
 * Keeps the choice in localStorage and writes it to <html data-theme data-color>. The script in
 * the root layout sets the same attributes before the first paint, so the screen never flashes
 * the wrong colours; this picks the stored choice back up for React.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [color, setColor] = useState<ThemeColor>("teal");

  useEffect(() => {
    const storedMode = localStorage.getItem(MODE_KEY);
    if (isMode(storedMode)) setMode(storedMode);
    const storedColor = localStorage.getItem(COLOR_KEY);
    if (isColor(storedColor)) setColor(storedColor);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.dataset.theme = mode === "system" ? (media.matches ? "dark" : "light") : mode;
    };
    apply();
    localStorage.setItem(MODE_KEY, mode);
    if (mode !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.color = color;
    localStorage.setItem(COLOR_KEY, color);
  }, [color]);

  return (
    <ThemeContext.Provider value={{ mode, color, setMode, setColor }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside a ThemeProvider");
  return value;
}

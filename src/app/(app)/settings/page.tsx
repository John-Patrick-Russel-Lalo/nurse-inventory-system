"use client";

import { COLORS, MODES, useTheme } from "@/components/ThemeProvider";
import { Card, IconCheck, PageHeader, Panel, cn } from "@/components/ui";

/**
 * Appearance settings. Nothing here touches stock: it only chooses light/dark and the colour
 * theme, and both take effect the moment they are tapped.
 */
export default function SettingsPage() {
  const { mode, color, setMode, setColor } = useTheme();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Make the screen easier on your eyes. Changes show straight away and are remembered on this device."
      />

      <Panel title="Light or dark" description="Auto follows whatever your device is set to.">
        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onClick={() => setMode(option.value)}
              className={cn(
                "cursor-pointer rounded-xl border px-3 py-2.5 text-sm transition-colors",
                mode === option.value
                  ? "border-accent bg-accent-soft font-semibold text-accent"
                  : "border-rule bg-surface text-muted hover:text-fg",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        title="Colour theme"
        description="One colour is used for buttons, links and highlights through the whole app."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {COLORS.map((option) => {
            const selected = color === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setColor(option.value)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-3 text-sm transition-colors",
                  selected
                    ? "border-accent bg-accent-soft font-semibold text-fg"
                    : "border-rule bg-surface text-muted hover:text-fg",
                )}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full shadow-card ring-1 ring-black/10"
                  style={{ backgroundColor: option.swatch }}
                >
                  {selected ? <IconCheck className="size-4 text-white" /> : null}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      </Panel>

      <Card className="p-4 text-sm text-muted">
        These choices are saved on this device only. They do not change anything for anyone else who
        signs in.
      </Card>
    </div>
  );
}

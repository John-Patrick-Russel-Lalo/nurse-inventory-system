"use client";

import { createContext, useContext, useState } from "react";

interface FocusValue {
  /** True while the menu and page title are hidden, leaving only the working screen. */
  focus: boolean;
  setFocus: (value: boolean) => void;
}

const FocusContext = createContext<FocusValue | undefined>(undefined);

/**
 * Focus mode hides everything that is not the screen you are working on. It lives here rather than
 * on one page because the sidebar it hides belongs to the app shell, not the page.
 */
export function FocusModeProvider({ children }: { children: React.ReactNode }) {
  const [focus, setFocus] = useState(false);
  return <FocusContext.Provider value={{ focus, setFocus }}>{children}</FocusContext.Provider>;
}

export function useFocusMode(): FocusValue {
  const value = useContext(FocusContext);
  if (!value) throw new Error("useFocusMode must be used inside a FocusModeProvider");
  return value;
}

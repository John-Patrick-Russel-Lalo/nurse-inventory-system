"use client";

import { createContext, useContext } from "react";
import { addDays } from "@/lib/dates";
import type { SessionInfo } from "@/lib/api-types";

const SessionContext = createContext<SessionInfo | null>(null);

/**
 * Supplied by the (app) layout from the server, so no screen has to fetch the session
 * before it can decide what a person is allowed to see.
 */
export function SessionProvider({ value, children }: { value: SessionInfo; children: React.ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionInfo {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>.");
  return value;
}

/** Shorthand for the checks that come up on nearly every screen. */
export function usePermissions() {
  const { user, today, closedMonths, nurseBackdateDays } = useSession();
  return {
    isAdmin: user.role === "ADMIN",
    today,
    closedMonths,
    nurseBackdateDays,
    /** Earliest date a nurse may record: today, less the backdate window. */
    earliestNurseDate: addDays(today, -nurseBackdateDays),
  };
}

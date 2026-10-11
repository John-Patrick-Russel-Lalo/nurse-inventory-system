"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSyncState, startOffline, store, subscribeSync, type SyncState } from "@/lib/offline";
import { useSession } from "./SessionProvider";

const OfflineContext = createContext<SyncState | null>(null);

/**
 * Starts the offline engine and remembers the signed-in person, so their session and the
 * stock survive a reload with no network. The navigation and status bar read the state here.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [state, setState] = useState<SyncState>(getSyncState());

  useEffect(() => {
    startOffline();
    return subscribeSync(setState);
  }, []);

  useEffect(() => {
    void store.saveSession({
      user: session.user,
      today: session.today,
      closedMonths: session.closedMonths,
      nurseBackdateDays: session.nurseBackdateDays,
      savedAt: Date.now(),
    });
  }, [session]);

  return <OfflineContext.Provider value={state}>{children}</OfflineContext.Provider>;
}

/** The offline state, for the status bar and anything else that needs it. */
export function useOffline(): SyncState {
  return useContext(OfflineContext) ?? getSyncState();
}

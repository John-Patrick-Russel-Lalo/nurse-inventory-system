"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  /** Re-runs the request. Call this after a write that changes what a screen shows. */
  reload: () => void;
  /** True while a reload is in flight but previous data is still on screen. */
  refreshing: boolean;
}

/**
 * Runs an async request when the screen mounts and whenever `deps` change.
 *
 * `run` is passed as an inline closure by callers, so it is deliberately not part of the
 * dependency list: the caller states the inputs it cares about in `deps` instead. Results
 * from a superseded request are discarded, so fast typing cannot leave stale data on screen.
 */
export function useApi<T>(run: () => Promise<T>, deps: readonly unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const runRef = useRef(run);

  // Synced in an effect rather than during render, so a render that React throws away cannot
  // leave a half-updated request behind. Declared first so the fetch effect below sees it.
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    let live = true;
    const isFirst = nonce === 0;
    if (isFirst) setLoading(true);
    else setRefreshing(true);

    runRef
      .current()
      .then((result) => {
        if (!live) return;
        setData(result);
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "Something went wrong.");
      })
      .finally(() => {
        if (!live) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, refreshing };
}

"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that lets a previously visited page open with no network.
 * Only in production: in development Next serves unhashed chunks the cache would pin.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration is best-effort; the app still works online without it.
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

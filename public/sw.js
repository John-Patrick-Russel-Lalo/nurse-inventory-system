// App-shell cache for the MediSakto app.
//
// Pages are server-rendered, so a page that was opened while online is kept as it was (HTML and
// its React Server Component payload) and served again with no network. API calls are left alone:
// the app itself answers those from IndexedDB, so the cache never fights the offline store.

const CACHE = "medisakto-shell-v1";
// The app root is behind the sign-in, so it is not pre-cached here: it is captured the first time
// it is opened while signed in. The login page is safe to keep from the start.
const SHELL = ["/login", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isStatic(url) {
  return (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.startsWith("/fonts") ||
    url.pathname === "/icon.svg"
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("/");
      if (shell) return shell;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The offline store owns the API; leave the auth handshake alone too.
  if (url.pathname.startsWith("/api/")) return;

  if (isStatic(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  const isRsc = request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  if (request.mode === "navigate" || isRsc || url.pathname.startsWith("/_next/data")) {
    event.respondWith(networkFirst(request));
  }
});

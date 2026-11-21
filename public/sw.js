// Shadow Haven service worker: lets the game install as an app and open
// instantly. It keeps a copy of the game's own files for when the network is
// slow or gone. It never touches the live game (/api/…) or other websites.
//
// Network first, so players always get the newest version when online; the
// stored copy is only the fallback. Bump VERSION to clear old copies.

const VERSION = "1.3.0";
const CACHE = `shadow-haven-${VERSION}`;
const SHELL = [
  "/",
  "/style.css",
  "/app.js",
  "/harbor.js",
  "/lanterns.js",
  "/sound.js",
  "/tasks.js",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shadow-haven-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts etc.: the browser handles them
  if (url.pathname.startsWith("/api/")) return;    // the live game is never cached

  if (req.mode === "navigate") {
    // Any page of the app (/, /r/CODE, /stats): fresh if possible, else the stored shell.
    event.respondWith(
      fetch(req)
        .then((res) => { if (res.ok && url.pathname === "/") keep("/", res.clone()); return res; })
        .catch(async () => (await caches.match(url.pathname === "/stats" ? "/stats" : "/")) || (await caches.match("/")) || Response.error()),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => { if (res.ok && res.type === "basic") keep(req, res.clone()); return res; })
      .catch(async () => (await caches.match(req)) || Response.error()),
  );
});

function keep(key, res) {
  caches.open(CACHE).then((c) => c.put(key, res)).catch(() => {});
}

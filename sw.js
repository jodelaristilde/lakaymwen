// Lakaymwen offline helper: keeps the site's own files on the phone so it opens
// fast on slow connections. Member data always comes fresh from the internet.
const CACHE = "lakaymwen-v13";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/i18n.js", "/towns.js", "/depts.js", "/geo.js", "/config.js",
  "/haiti-map.svg", "/manifest.webmanifest", "/icon-192.png", "/logo-word.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // Supabase, fonts, photos: always from the network
  // Try the network first so updates show up right away; fall back to the saved copy when offline.
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match("/index.html"))));
});

// 🔔 Phone notifications: show the alert, and open Lakaymwen when it's tapped
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Lakaymwen", {
    body: d.body || "You have something new on Lakaymwen.",
    icon: "/icon-192.png", badge: "/icon-192.png",
    tag: d.tag || "lakaymwen", renotify: true,
    data: { url: d.url || "/" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if (new URL(c.url).origin === self.location.origin && "focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

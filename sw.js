const CACHE = 'drift-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always try to fetch the latest version when online (so updates
// show up immediately after a redeploy), and only fall back to the cached copy
// when there's no connection at all.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

/* ===================== Push notifications =====================
   Service workers can be killed and restarted by the browser at any time,
   so an in-memory variable won't reliably survive between pushes. IndexedDB
   is the standard way to persist small config here. The main app page sends
   the backend URL + shared key over via postMessage whenever it changes. */

const IDB_NAME = 'drift-sw';
const IDB_STORE = 'config';

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, 'readonly');
      const getReq = tx.objectStore(IDB_STORE).get(key);
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function idbSet(key, value) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'drift-config') {
    idbSet('config', { workerUrl: event.data.workerUrl, sharedKey: event.data.sharedKey }).catch(() => {});
  }
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const cfg = await idbGet('config').catch(() => null);
      if (!cfg || !cfg.workerUrl || !cfg.sharedKey) return;
      try {
        const res = await fetch(`${cfg.workerUrl.replace(/\/+$/, '')}/api/push/whats-due`, {
          headers: { 'X-Drift-Key': cfg.sharedKey }
        });
        const data = await res.json();
        const notifications = data.notifications || [];
        for (const n of notifications) {
          await self.registration.showNotification(n.title, {
            body: n.body,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png'
          });
        }
      } catch {
        // Silently do nothing if the backend can't be reached — better than crashing the SW.
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsList) => {
      if (clientsList.length) return clientsList[0].focus();
      return self.clients.openWindow('./');
    })
  );
});

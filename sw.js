// sw.js - CMR RouteIQ Service Worker
// Production PWA Offline Support & Cache Management
// Project: routeiq-d2104

const CACHE_NAME = 'routeiq-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/signup.html',
  '/cmr_logo.png',
  '/cmr_bus_logo.png',
  '/bus_logo.png',
  '/logo.png'
];

// URLs that must NEVER be intercepted or cached by the Service Worker
const BYPASS_URL_PATTERNS = [
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseio.com',
  '/api/'
];

self.addEventListener('install', (event) => {
  // Activate new service worker immediately without waiting
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('PWA: Static asset pre-caching notice:', err.message);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Purge any outdated caches
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      })
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url || '';

  // 1. Never intercept non-GET requests (e.g. POST for auth, login, signup, APIs)
  if (req.method !== 'GET') {
    return;
  }

  // 2. Never intercept Firebase Authentication, Firestore, or Google APIs
  if (BYPASS_URL_PATTERNS.some((pattern) => url.includes(pattern))) {
    return;
  }

  // 3. For localhost development, bypass service worker caching completely
  const isLocalhost = Boolean(
    self.location.hostname === 'localhost' ||
    self.location.hostname === '127.0.0.1' ||
    self.location.hostname === '[::1]'
  );

  if (isLocalhost) {
    // In local development, always fetch directly from network.
    // If the network request fails, return a guaranteed valid Response (NEVER undefined).
    event.respondWith(
      fetch(req).catch(async (fetchErr) => {
        console.warn('PWA Local Network Fallback:', fetchErr.message);
        const cached = await caches.match(req);
        if (cached) return cached;
        return new Response(
          '<!DOCTYPE html><html><body><h3>Network Offline</h3><p>Unable to connect to local development server.</p></body></html>',
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          }
        );
      })
    );
    return;
  }

  // 4. Production Strategy: Network-first with Cache Fallback
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        // Only cache valid basic responses
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // Fallback to cache if network is unavailable
        const cached = await caches.match(req);
        if (cached) {
          return cached;
        }

        // Navigation fallback for offline HTML views
        if (req.mode === 'navigate') {
          const cachedIndex = await caches.match('/index.html') || await caches.match('/');
          if (cachedIndex) return cachedIndex;
        }

        // Safe fallback: ALWAYS return a valid Response object (prevent "Failed to convert value to 'Response'")
        return new Response(
          '<!DOCTYPE html><html><body><h3>Offline</h3><p>This resource is unavailable while offline.</p></body></html>',
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          }
        );
      })
  );
});

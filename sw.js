const CACHE_NAME = "gigflow-shell-v12";
const SHARE_CACHE = "gigflow-shared-offers-v1";
const SHARE_ROUTE = "/share-target";
const SHARE_ASSET_ROUTE = "/__gigflow-share/";
const TRACKING_DB = "gigflow-runtime";
const TRACKING_STORE = "tracking";
const ACTIVE_TRACKING_KEY = "active";
const ACTIVE_TRACKING_TAG = "gig-flow-active-tracking";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./ocr-worker.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => ![CACHE_NAME, SHARE_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (request.method === "POST" && isSameOrigin && url.pathname.endsWith(SHARE_ROUTE)) {
    event.respondWith(handleShareTarget(request));
    return;
  }

  if (request.method !== "GET") return;

  if (isSameOrigin && url.pathname.includes(SHARE_ASSET_ROUTE)) {
    event.respondWith(readSharedOfferImage(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html"));
    return;
  }

  if (isSameOrigin) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(handlePushWake(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "./index.html";

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const matchingClient = windowClients.find((client) => client.url.includes("index.html"));

    if (matchingClient) {
      await matchingClient.focus();
      matchingClient.postMessage({
        type: "GIGFLOW_TRACKING_NOTIFICATION_OPENED",
        data: event.notification.data || {}
      });
      return;
    }

    await self.clients.openWindow(targetUrl);
  })());
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = findSharedImage(formData);

    if (!file) {
      return Response.redirect("./index.html?shareError=no-image", 303);
    }

    const shareId = `${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2)}`;
    const cache = await caches.open(SHARE_CACHE);
    const shareUrl = new URL(`${SHARE_ASSET_ROUTE}${encodeURIComponent(shareId)}`, self.location.origin);

    await cache.put(shareUrl.toString(), new Response(file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Gig-Flow-Share-Id": shareId
      }
    }));

    await notifyClients({
      type: "GIGFLOW_SHARE_IMAGE_READY",
      shareId,
      name: file.name || "shared-offer",
      mimeType: file.type || "application/octet-stream"
    });

    return Response.redirect(`./index.html?shareId=${encodeURIComponent(shareId)}`, 303);
  } catch (error) {
    console.error("Share target handling failed.", error);
    return Response.redirect("./index.html?shareError=processing", 303);
  }
}

function findSharedImage(formData) {
  const directFile = formData.get("screenshot");
  if (isImageFile(directFile)) return directFile;

  for (const value of formData.values()) {
    if (isImageFile(value)) return value;
  }

  return null;
}

function isImageFile(value) {
  return value instanceof File && /^image\/(png|jpe?g)$/i.test(value.type || "");
}

async function readSharedOfferImage(request) {
  const cache = await caches.open(SHARE_CACHE);
  const cached = await cache.match(request);
  return cached || new Response("Shared image not found.", { status: 404 });
}

async function handlePushWake(event) {
  const payload = readPushPayload(event.data);

  if (payload.type === "coop-dispatch-offer") {
    await handleCoopDispatchPush(payload);
    return;
  }

  await self.registration.showNotification(payload.title || "GIG FLOW Active Tracking", {
    body: "Checking active gig route...",
    tag: ACTIVE_TRACKING_TAG,
    renotify: false,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: {
      url: "./index.html?tracking=1",
      payload
    }
  });

  const result = await evaluateActiveTracking(payload);

  await self.registration.showNotification(payload.title || "GIG FLOW Active Tracking", {
    body: result.message,
    tag: ACTIVE_TRACKING_TAG,
    renotify: false,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: {
      url: "./index.html?tracking=1",
      payload,
      result
    }
  });

  await notifyClients({
    type: "GIGFLOW_TRACKING_RESULT",
    payload,
    result
  });
}

async function handleCoopDispatchPush(payload) {
  await self.registration.showNotification(payload.title || "New Co-op Dispatch Offer", {
    body: dispatchOfferBody(payload),
    tag: `gig-flow-coop-dispatch-${payload.offerId || payload.externalOfferId || "offer"}`,
    renotify: true,
    requireInteraction: true,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: {
      url: "./index.html?dispatch=1",
      payload
    }
  });

  await notifyClients({
    type: "GIGFLOW_COOP_DISPATCH_OFFER",
    payload
  });
}

function dispatchOfferBody(payload) {
  const offer = payload.offer || {};
  const payout = offer.payout ? `$${Number(offer.payout).toFixed(2)}` : "New offer";
  const miles = offer.distanceMiles ? `${Number(offer.distanceMiles).toFixed(1)} mi` : "";
  const partner = payload.partner?.name || "Co-op";
  return [partner, payout, miles].filter(Boolean).join(" • ");
}

function readPushPayload(data) {
  if (!data) return { type: "active-tracking-check" };

  try {
    return data.json();
  } catch {
    return { type: "active-tracking-check", body: data.text() };
  }
}

async function evaluateActiveTracking(payload) {
  // Service workers cannot request live GPS; the foreground app persists last known location here.
  const tracking = await idbGet(ACTIVE_TRACKING_KEY) || {};
  const location = tracking.lastKnownLocation;
  const geofences = payload.geofences || tracking.geofences || [];
  const routeWindows = payload.routeWindows || tracking.routeWindows || [];

  if (!location) {
    return {
      status: "needs-foreground-location",
      message: "Open GIG FLOW to refresh active tracking."
    };
  }

  const ageMs = Date.now() - Number(location.timestamp || 0);
  const staleAfterMs = Number(payload.staleAfterMs || tracking.staleAfterMs || 10 * 60 * 1000);

  if (ageMs > staleAfterMs) {
    return {
      status: "stale-location",
      message: "Active tracking is running with a stale location. Open GIG FLOW to refresh GPS."
    };
  }

  const geofenceMatches = geofences
    .map((geofence) => ({
      ...geofence,
      distanceMeters: distanceMeters(location, geofence),
      inside: distanceMeters(location, geofence) <= Number(geofence.radiusMeters || 150)
    }))
    .filter((geofence) => geofence.inside);

  const routeWindowMatches = routeWindows.filter((window) => isInsideRouteWindow(window, Date.now()));

  if (geofenceMatches.length) {
    return {
      status: "inside-geofence",
      message: `Near ${geofenceMatches[0].name || "active gig zone"}.`,
      geofenceMatches,
      routeWindowMatches
    };
  }

  return {
    status: "clear",
    message: "Active tracking check complete.",
    geofenceMatches,
    routeWindowMatches
  };
}

function isInsideRouteWindow(routeWindow, now) {
  const start = Number(routeWindow.startAt || 0);
  const end = Number(routeWindow.endAt || 0);
  if (!start || !end) return false;
  return now >= start && now <= end;
}

function distanceMeters(a, b) {
  const lat1 = Number(a.latitude);
  const lon1 = Number(a.longitude);
  const lat2 = Number(b.latitude);
  const lon2 = Number(b.longitude);

  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

  const earthRadiusMeters = 6371000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(message));
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await cache.match(request)) || cache.match(fallbackUrl);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    refreshCache(cache, request);
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function refreshCache(cache, request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response);
    }
  } catch (error) {
    // Offline is expected for a PWA cache refresh.
  }
}

function openTrackingDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TRACKING_DB, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(TRACKING_STORE);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openTrackingDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TRACKING_STORE, "readonly");
    const store = transaction.objectStore(TRACKING_STORE);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

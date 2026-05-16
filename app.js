import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { Purchases } from "https://esm.sh/@revenuecat/purchases-js@1.41.0";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCZlSBbi7lZLBctmfHUdRrOARHpm7T93Ow",
  authDomain: "gig-flow-5930d.firebaseapp.com",
  projectId: "gig-flow-5930d",
  storageBucket: "gig-flow-5930d.firebasestorage.app",
  messagingSenderId: "876072390705",
  appId: "1:876072390705:web:cafdf507a03029981e4510"
};

const REVENUECAT_API_KEY = "rcb_jlWXOUxRmZngwIqocoryMfEpfGmK";
const REVENUECAT_ENTITLEMENT = "premium";
const OFFERING_ID = "standard_v2";

const PLAN_DEFINITIONS = [
  {
    id: "$rc_monthly",
    label: "Monthly",
    price: "$2.99",
    cadence: "per month",
    note: "Flexible access for weekly earners."
  },
  {
    id: "$rc_three_month",
    label: "Quarterly",
    price: "$9.99",
    cadence: "per quarter",
    note: "Three months of command center tools."
  },
  {
    id: "$rc_annual",
    label: "Yearly",
    price: "$39.99",
    cadence: "per year",
    note: "Best value for full-year operators."
  }
];

const TAX_MILEAGE_RATES = {
  "2024": 0.67,
  "2025": 0.70,
  "2026": 0.725
};

const PREMIUM_TABS = new Set(["vault", "analytics"]);
const SHARE_ASSET_ROUTE = "./__gigflow-share/";
const RUNTIME_DB = "gigflow-runtime";
const TRACKING_STORE = "tracking";
const ACTIVE_TRACKING_KEY = "active";
const DEFAULT_TRACKING_STALE_MS = 10 * 60 * 1000;
const INSTALL_PROMPT_DISMISSED_KEY = "gigflow-install-prompt-dismissed";
const INSTALL_PROMPT_ACCEPTED_KEY = "gigflow-install-prompt-accepted";

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(firebaseApp);

let db;
try {
  db = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (error) {
  console.warn("Persistent Firestore cache unavailable; falling back to memory cache.", error);
  db = initializeFirestore(firebaseApp, {
    localCache: memoryLocalCache()
  });
}

const state = {
  authUser: null,
  profile: null,
  purchases: null,
  isPremium: false,
  selectedPlanId: PLAN_DEFINITIONS[0].id,
  revenueCatPackages: {},
  activeTab: "calculator",
  filters: {
    platform: "All",
    sort: "newest"
  },
  shifts: [],
  expenses: [],
  latestCalc: null,
  ocrWorker: null,
  geoWatchId: null,
  shiftTrackingActive: false,
  lastOcrParsed: null,
  deferredInstallPrompt: null,
  charts: {
    profit: null,
    breakdown: null
  }
};

const ui = {};

function byId(id) {
  return document.getElementById(id);
}

function cacheElements() {
  [
    "authView",
    "appView",
    "authForm",
    "emailInput",
    "passwordInput",
    "authStatus",
    "platform",
    "basePay",
    "tips",
    "promo",
    "gross",
    "activeMiles",
    "deadheadMiles",
    "waitMinutes",
    "startTime",
    "endTime",
    "gasPrice",
    "mpg",
    "maintenanceRate",
    "profitDisplay",
    "hourlyDisplay",
    "distanceDisplay",
    "gasDisplay",
    "shiftStatus",
    "shiftTrackingToggle",
    "trackingStateLabel",
    "trackingStatus",
    "coopPartnerId",
    "vehicleSeats",
    "vehicleCargoLiters",
    "coopAvailable",
    "adPanel",
    "historyList",
    "filterStatus",
    "vaultYearTotal",
    "vaultDate",
    "vaultAmount",
    "vaultCategory",
    "vaultOdometer",
    "vaultNotes",
    "vaultEditId",
    "vaultStatus",
    "vaultList",
    "analyticsSummary",
    "analyticsStatus",
    "profitChart",
    "breakdownChart",
    "exportYear",
    "filterBackdrop",
    "filterSheet",
    "filterPlatform",
    "filterSort",
    "paywallBackdrop",
    "paywallSheet",
    "planList",
    "paywallStatus",
    "subscribeButton",
    "offerOcrPanel",
    "ocrStatus",
    "ocrResult",
    "ocrReview",
    "ocrPlatformConfirm",
    "ocrEarningsConfirm",
    "ocrMilesConfirm",
    "ocrPassengerFare",
    "dataUnionConsent",
    "submitDataUnionButton",
    "dataUnionStatus",
    "installPromptBackdrop",
    "installPromptModal",
    "installPromptButton",
    "installPromptStatus",
    "installFallbackCopy"
  ].forEach((id) => {
    ui[id] = byId(id);
  });
}

function currency(value) {
  const amount = Number.isFinite(value) ? value : 0;
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
}

function numberValue(element, fallback = 0) {
  const value = parseFloat(element?.value ?? "");
  return Number.isFinite(value) ? value : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(element, message = "", tone = "") {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", tone === "error");
  element.classList.toggle("is-success", tone === "success");
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function displayDate(timestamp) {
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function timestampFromDateInput(value) {
  if (!value) return Date.now();
  const dateStart = new Date(`${value}T00:00:00`).getTime();
  const dayOffset = Date.now() % 86400000;
  return dateStart + dayOffset;
}

function runtimeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RUNTIME_DB, 1);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(TRACKING_STORE)) {
        request.result.createObjectStore(TRACKING_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runtimeStore(mode, callback) {
  const db = await runtimeDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TRACKING_STORE, mode);
    const store = transaction.objectStore(TRACKING_STORE);
    const request = callback(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function readTrackingState() {
  return runtimeStore("readonly", (store) => store.get(ACTIVE_TRACKING_KEY));
}

async function writeTrackingState(patch) {
  const current = await readTrackingState().catch(() => null);
  const next = {
    ...(current || {}),
    ...patch,
    updatedAt: Date.now()
  };

  await runtimeStore("readwrite", (store) => store.put(next, ACTIVE_TRACKING_KEY));
  return next;
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function postJson(url, body, adminToken = "") {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json().catch(() => ({}));
}

async function fetchVapidPublicKey(apiBase = "") {
  const response = await fetch(`${apiBase}/api/push/vapid-public-key`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Could not fetch the VAPID public key.");
  }

  const payload = await response.json();
  if (!payload.publicKey) {
    throw new Error("Push backend did not return a VAPID public key.");
  }

  return payload.publicKey;
}

function hasPremiumEntitlement(customerInfo) {
  return Boolean(customerInfo?.entitlements?.active?.[REVENUECAT_ENTITLEMENT]);
}

async function ensureUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    return snap.data();
  }

  const profile = {
    isPremium: false,
    subscriptionTier: "free",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await setDoc(userRef, profile);
  return profile;
}

async function configureRevenueCat(userId) {
  if (!state.purchases) {
    state.purchases = Purchases.configure({
      apiKey: REVENUECAT_API_KEY,
      appUserId: userId
    });
    return state.purchases;
  }

  const currentAppUserId = typeof state.purchases.getAppUserId === "function"
    ? state.purchases.getAppUserId()
    : userId;

  if (currentAppUserId !== userId && typeof state.purchases.changeUser === "function") {
    await state.purchases.changeUser(userId);
  }

  return state.purchases;
}

async function refreshPremiumState() {
  if (!state.purchases || !state.authUser) return false;

  const customerInfo = await state.purchases.getCustomerInfo();
  const isPremium = hasPremiumEntitlement(customerInfo);
  state.isPremium = isPremium;

  if (state.profile?.isPremium !== isPremium) {
    state.profile = {
      ...state.profile,
      isPremium,
      updatedAt: Date.now()
    };
    await setDoc(
      doc(db, "users", state.authUser.uid),
      {
        isPremium,
        updatedAt: Date.now()
      },
      { merge: true }
    );
  }

  renderAdPanel();
  return isPremium;
}

async function handleAuthChange(user) {
  state.authUser = user;
  state.profile = null;
  state.isPremium = false;
  state.revenueCatPackages = {};
  state.selectedPlanId = PLAN_DEFINITIONS[0].id;

  if (!user) {
    ui.authView.hidden = false;
    ui.appView.hidden = true;
    renderAdPanel();
    return;
  }

  ui.authView.hidden = true;
  ui.appView.hidden = false;
  setStatus(ui.authStatus);

  try {
    state.profile = await ensureUserProfile(user);
    state.isPremium = Boolean(state.profile.isPremium);
    await configureRevenueCat(user.uid);
    await refreshPremiumState();
    await fetchRevenueCatOfferings({ silent: true });
  } catch (error) {
    console.error("Login bootstrap failed.", error);
    setStatus(ui.paywallStatus, "Subscription tools are temporarily unavailable.", "error");
  }

  setDefaultDates();
  updateCalculator();
  renderAdPanel();
}

async function login() {
  setStatus(ui.authStatus, "Signing in...");
  const email = ui.emailInput.value.trim();
  const password = ui.passwordInput.value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    ui.passwordInput.value = "";
  } catch (error) {
    setStatus(ui.authStatus, error.message, "error");
  }
}

async function signup() {
  setStatus(ui.authStatus, "Creating account...");
  const email = ui.emailInput.value.trim();
  const password = ui.passwordInput.value;

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", credential.user.uid), {
      isPremium: false,
      subscriptionTier: "free",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    ui.passwordInput.value = "";
    setStatus(ui.authStatus, "Account created.", "success");
  } catch (error) {
    setStatus(ui.authStatus, error.message, "error");
  }
}

async function logout() {
  await signOut(auth);
  closePaywall();
  closeFilter();
  switchVisibleTab("calculator");
}

function getOfferingPackageMap(offering) {
  if (!offering) return {};
  if (offering.packagesById) return offering.packagesById;
  return Object.fromEntries((offering.availablePackages || []).map((pkg) => [pkg.identifier, pkg]));
}

function productDisplayPrice(pkg) {
  const product = pkg?.webBillingProduct || pkg?.rcBillingProduct || pkg?.product || {};
  return product?.currentPrice?.formattedPrice || product?.priceString || "";
}

async function fetchRevenueCatOfferings(options = {}) {
  if (!state.purchases) return;

  if (!options.silent) {
    setStatus(ui.paywallStatus, "Loading standard_v2 tiers...");
  }

  try {
    const offerings = await state.purchases.getOfferings({ currency: "USD" });
    const offering = offerings.all?.[OFFERING_ID];

    if (!offering) {
      throw new Error(`RevenueCat did not return the ${OFFERING_ID} offering.`);
    }

    const packageMap = getOfferingPackageMap(offering);
    state.revenueCatPackages = PLAN_DEFINITIONS.reduce((acc, plan) => {
      acc[plan.id] = packageMap[plan.id] || null;
      return acc;
    }, {});

    const diagnostics = PLAN_DEFINITIONS.map((plan) => {
      const pkg = state.revenueCatPackages[plan.id];
      const backendPrice = productDisplayPrice(pkg);
      if (backendPrice && backendPrice !== plan.price) {
        console.warn(`RevenueCat package ${plan.id} returned ${backendPrice}; UI is pinned to ${plan.price}.`);
      }
      return {
        expectedOrder: plan.label,
        packageId: plan.id,
        packageReturned: Boolean(pkg),
        backendPrice
      };
    });
    console.table(diagnostics);

    const missing = diagnostics.filter((row) => !row.packageReturned).map((row) => row.packageId);
    renderPaywallPlans();

    if (missing.length) {
      setStatus(ui.paywallStatus, `Missing from ${OFFERING_ID}: ${missing.join(", ")}`, "error");
    } else if (!options.silent) {
      setStatus(ui.paywallStatus, `${OFFERING_ID} loaded with all three packages.`, "success");
    } else {
      setStatus(ui.paywallStatus);
    }
  } catch (error) {
    console.error("RevenueCat offering fetch failed.", error);
    state.revenueCatPackages = {};
    renderPaywallPlans();
    setStatus(ui.paywallStatus, error.message, "error");
  }
}

function renderPaywallPlans() {
  ui.planList.innerHTML = PLAN_DEFINITIONS.map((plan) => {
    const isSelected = state.selectedPlanId === plan.id;
    const isAvailable = Boolean(state.revenueCatPackages[plan.id]);
    const classes = [
      "plan-card",
      isSelected ? "is-selected" : "",
      isAvailable ? "" : "is-unavailable"
    ].filter(Boolean).join(" ");

    return `
      <button class="${classes}" type="button" data-plan-id="${escapeHtml(plan.id)}" data-package-ready="${isAvailable}" aria-pressed="${isSelected}">
        <span>
          <strong class="plan-name">${escapeHtml(plan.label)}</strong>
          <span class="plan-note">${escapeHtml(isAvailable ? plan.note : "Waiting for RevenueCat package.")}</span>
        </span>
        <span class="plan-price">${escapeHtml(plan.price)}<small>${escapeHtml(plan.cadence)}</small></span>
      </button>
    `;
  }).join("");

  syncSubscribeButton();
}

function syncSubscribeButton() {
  const selectedPackage = state.revenueCatPackages[state.selectedPlanId];
  const selectedPlan = PLAN_DEFINITIONS.find((plan) => plan.id === state.selectedPlanId);
  ui.subscribeButton.disabled = !state.authUser || !state.purchases || !selectedPackage;
  ui.subscribeButton.textContent = selectedPlan
    ? `Subscribe ${selectedPlan.label}`
    : "Subscribe Now";
}

async function openPaywall() {
  ui.paywallBackdrop.hidden = false;
  ui.paywallSheet.hidden = false;
  renderPaywallPlans();
  await fetchRevenueCatOfferings();
}

function closePaywall() {
  ui.paywallBackdrop.hidden = true;
  ui.paywallSheet.hidden = true;
}

async function subscribeSelectedPlan() {
  const pkg = state.revenueCatPackages[state.selectedPlanId];
  const plan = PLAN_DEFINITIONS.find((item) => item.id === state.selectedPlanId);

  if (!pkg || !state.purchases || !state.authUser) {
    setStatus(ui.paywallStatus, "This plan is not ready for checkout yet.", "error");
    return;
  }

  ui.subscribeButton.disabled = true;
  setStatus(ui.paywallStatus, `Opening checkout for ${plan.label}...`);

  try {
    const purchaseResult = await state.purchases.purchase({ rcPackage: pkg });

    const customerInfo = purchaseResult.customerInfo || purchaseResult;
    if (!hasPremiumEntitlement(customerInfo)) {
      setStatus(ui.paywallStatus, "Checkout completed, but premium entitlement is not active yet.", "error");
      syncSubscribeButton();
      return;
    }

    state.isPremium = true;
    state.profile = {
      ...state.profile,
      isPremium: true,
      subscriptionTier: state.selectedPlanId,
      updatedAt: Date.now()
    };

    await setDoc(
      doc(db, "users", state.authUser.uid),
      {
        isPremium: true,
        subscriptionTier: state.selectedPlanId,
        updatedAt: Date.now()
      },
      { merge: true }
    );

    setStatus(ui.paywallStatus, "GIG FLOW PRO is active.", "success");
    renderAdPanel();
    closePaywall();
  } catch (error) {
    const message = String(error?.message || "");
    const cancelled = error?.userCancelled || /cancel/i.test(message) || /UserCancelled/i.test(String(error?.errorCode || ""));
    setStatus(ui.paywallStatus, cancelled ? "Checkout cancelled." : `Checkout failed: ${message}`, cancelled ? "" : "error");
    syncSubscribeButton();
  }
}

async function ensurePremiumAccess() {
  if (state.isPremium) return true;

  try {
    const isPremium = await refreshPremiumState();
    if (isPremium) return true;
  } catch (error) {
    console.warn("Premium entitlement check failed.", error);
  }

  await openPaywall();
  return false;
}

function openFilter() {
  ui.filterPlatform.value = state.filters.platform;
  ui.filterSort.value = state.filters.sort;
  ui.filterBackdrop.hidden = false;
  ui.filterSheet.hidden = false;
}

function closeFilter() {
  ui.filterBackdrop.hidden = true;
  ui.filterSheet.hidden = true;
}

function applyFilter() {
  state.filters.platform = ui.filterPlatform.value;
  state.filters.sort = ui.filterSort.value;
  closeFilter();
  renderHistory();
}

function resetFilter() {
  state.filters.platform = "All";
  state.filters.sort = "newest";
  ui.filterPlatform.value = "All";
  ui.filterSort.value = "newest";
  closeFilter();
  renderHistory();
}

function calculateHours(startValue, endValue) {
  if (!startValue || !endValue) return 0;
  const [startHours, startMinutes] = startValue.split(":").map(Number);
  const [endHours, endMinutes] = endValue.split(":").map(Number);
  let hours = endHours - startHours + (endMinutes - startMinutes) / 60;
  if (hours < 0) hours += 24;
  return hours;
}

function calculateShift() {
  const basePay = numberValue(ui.basePay);
  const tips = numberValue(ui.tips);
  const promo = numberValue(ui.promo);
  const gross = basePay + tips + promo;
  const activeMiles = numberValue(ui.activeMiles);
  const deadheadMiles = numberValue(ui.deadheadMiles);
  const miles = activeMiles + deadheadMiles;
  const waitMinutes = numberValue(ui.waitMinutes);
  const hours = calculateHours(ui.startTime.value, ui.endTime.value);
  const gasPrice = numberValue(ui.gasPrice, 5);
  const mpg = Math.max(numberValue(ui.mpg, 25), 1);
  const maintenanceRate = numberValue(ui.maintenanceRate, 0.05);
  const gasCost = miles * (gasPrice / mpg);
  const maintenanceCost = miles * maintenanceRate;
  const profit = gross - gasCost - maintenanceCost;
  const totalHours = hours + waitMinutes / 60;
  const hourly = totalHours > 0 ? profit / totalHours : 0;

  return {
    basePay,
    tips,
    promo,
    gross,
    activeMiles,
    deadheadMiles,
    miles,
    waitMinutes,
    hours,
    gasPrice,
    mpg,
    maintenanceRate,
    gasCost,
    maintenanceCost,
    profit,
    hourly
  };
}

function updateCalculator() {
  const calc = calculateShift();
  state.latestCalc = calc;
  ui.gross.value = currency(calc.gross);
  ui.profitDisplay.textContent = currency(calc.profit);
  ui.hourlyDisplay.textContent = `${currency(calc.hourly)}/hr`;
  ui.distanceDisplay.textContent = `${calc.miles.toFixed(1)} mi`;
  ui.gasDisplay.textContent = currency(calc.gasCost);
  return calc;
}

function renderTrackingState() {
  if (!ui.shiftTrackingToggle) return;

  const card = ui.shiftTrackingToggle.closest(".tracking-card");
  card?.classList.toggle("is-active", state.shiftTrackingActive);
  ui.trackingStateLabel.textContent = state.shiftTrackingActive ? "On Shift" : "Off Shift";
  ui.shiftTrackingToggle.textContent = state.shiftTrackingActive ? "End Shift" : "Start Shift";
  ui.shiftTrackingToggle.setAttribute("aria-pressed", String(state.shiftTrackingActive));
}

function trackingOptionsFromUi() {
  const geofences = buildDefaultGeofences();

  return {
    apiBase: window.GIG_FLOW_PUSH_API_BASE || "",
    intervalMs: 3 * 60 * 1000,
    geofences,
    routeWindows: [{
      startAt: Date.now(),
      endAt: Date.now() + 12 * 60 * 60 * 1000
    }],
    partnerId: ui.coopPartnerId.value.trim(),
    vehicleCapacity: {
      seats: numberValue(ui.vehicleSeats, 0),
      cargoLiters: numberValue(ui.vehicleCargoLiters, 0)
    }
  };
}

function buildDefaultGeofences() {
  const platform = ui.platform.value || "Active gig zone";
  return [{
    name: `${platform} active zone`,
    latitude: 0,
    longitude: 0,
    radiusMeters: 250
  }];
}

async function toggleShiftTrackingFromUi() {
  if (!state.authUser) {
    setStatus(ui.trackingStatus, "Sign in before starting shift tracking.", "error");
    return;
  }

  ui.shiftTrackingToggle.disabled = true;
  setStatus(ui.trackingStatus, state.shiftTrackingActive ? "Ending shift..." : "Starting shift...");

  try {
    const options = trackingOptionsFromUi();

    if (state.shiftTrackingActive) {
      const endShift = window.GigFlow?.endShiftTracking || endShiftTracking;
      await endShift({ apiBase: options.apiBase });
      state.shiftTrackingActive = false;
      setStatus(ui.trackingStatus, "Shift tracking stopped.", "success");
    } else {
      const startShift = window.GigFlow?.startShiftTracking || startShiftTracking;
      await startShift(options);
      state.shiftTrackingActive = true;
      setStatus(ui.trackingStatus, "Shift tracking is active.", "success");

      if (ui.coopAvailable.checked) {
        const syncTelemetry = window.GigFlow?.syncCoopDriverTelemetry || syncCoopDriverTelemetry;
        await syncTelemetry({
          apiBase: options.apiBase,
          partnerId: options.partnerId,
          vehicleCapacity: options.vehicleCapacity,
          status: "AVAILABLE_FOR_COOP"
        });
      }
    }
  } catch (error) {
    console.error("Shift tracking toggle failed.", error);
    setStatus(ui.trackingStatus, error.message, "error");
  } finally {
    ui.shiftTrackingToggle.disabled = false;
    renderTrackingState();
  }
}

async function handleSharedOfferImage(shareId) {
  if (!shareId) return;

  ui.offerOcrPanel.hidden = false;
  ui.ocrResult.hidden = true;
  setStatus(ui.ocrStatus, "Reading shared gig offer locally...");

  try {
    const response = await fetch(`${SHARE_ASSET_ROUTE}${encodeURIComponent(shareId)}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("The shared screenshot was not available to the app.");
    }

    const image = await response.blob();
    const parsed = await runOfferOcr(image);
    applyParsedOffer(parsed);
    renderOcrResult(parsed);
  } catch (error) {
    console.error("Shared offer OCR failed.", error);
    setStatus(ui.ocrStatus, error.message, "error");
  }
}

function runOfferOcr(image) {
  if (!window.Worker) {
    return Promise.reject(new Error("This browser does not support OCR workers."));
  }

  const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const worker = new Worker("./ocr-worker.js", { name: "gig-flow-offer-ocr" });
  state.ocrWorker?.terminate();
  state.ocrWorker = worker;

  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      const message = event.data || {};
      if (message.requestId !== requestId) return;

      if (message.type === "progress") {
        const percent = Math.round((message.progress?.progress || 0) * 100);
        const label = message.progress?.status || "processing";
        setStatus(ui.ocrStatus, `OCR ${label} ${percent}%`);
        return;
      }

      if (message.type === "result") {
        worker.terminate();
        if (state.ocrWorker === worker) state.ocrWorker = null;
        resolve(message.parsed || {});
        return;
      }

      if (message.type === "error") {
        worker.terminate();
        if (state.ocrWorker === worker) state.ocrWorker = null;
        reject(new Error(message.message || "OCR failed."));
      }
    };

    worker.onerror = (error) => {
      worker.terminate();
      if (state.ocrWorker === worker) state.ocrWorker = null;
      reject(new Error(error.message || "OCR worker failed."));
    };

    worker.postMessage({ type: "recognize", requestId, image });
  });
}

function applyParsedOffer(parsed) {
  state.lastOcrParsed = parsed || null;

  if (parsed.platform && [...ui.platform.options].some((option) => option.value === parsed.platform)) {
    ui.platform.value = parsed.platform;
  }

  if (Number.isFinite(parsed.grossAmount)) {
    ui.basePay.value = parsed.grossAmount.toFixed(2);
    ui.tips.value = "";
    ui.promo.value = "";
  }

  if (Number.isFinite(parsed.miles)) {
    ui.activeMiles.value = parsed.miles.toFixed(1);
    ui.deadheadMiles.value = "";
  }

  updateCalculator();
}

function renderOcrResult(parsed) {
  const amount = Number.isFinite(parsed.grossAmount) ? currency(parsed.grossAmount) : "Not found";
  const miles = Number.isFinite(parsed.miles) ? `${parsed.miles.toFixed(1)} mi` : "Not found";
  const platform = parsed.platform || "Unknown";
  const confidence = Math.round((parsed.confidence || 0) * 100);

  ui.ocrResult.innerHTML = `
    <span>Platform <strong>${escapeHtml(platform)}</strong></span>
    <span>Offer <strong>${escapeHtml(amount)}</strong></span>
    <span>Miles <strong>${escapeHtml(miles)}</strong></span>
  `;
  ui.ocrResult.hidden = false;
  renderOcrReview(parsed);
  setStatus(ui.ocrStatus, `Offer parsed locally with ${confidence}% confidence.`, "success");
  maybeShowInstallPromptAfterOcr(parsed);
}

function maybeShowInstallPromptAfterOcr(parsed) {
  const hasUsefulData = Boolean(parsed?.platform || Number.isFinite(parsed?.grossAmount) || Number.isFinite(parsed?.miles));
  if (!hasUsefulData || !ui.installPromptModal) return;
  if (isPwaInstalled()) return;
  if (localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY) || localStorage.getItem(INSTALL_PROMPT_ACCEPTED_KEY)) return;

  openInstallPrompt();
}

function openInstallPrompt() {
  ui.installPromptBackdrop.hidden = false;
  ui.installPromptModal.hidden = false;
  ui.installFallbackCopy.hidden = Boolean(state.deferredInstallPrompt);
  ui.installPromptButton.textContent = state.deferredInstallPrompt ? "Install" : "Show Me How";
  setStatus(ui.installPromptStatus);
}

function closeInstallPrompt() {
  ui.installPromptBackdrop.hidden = true;
  ui.installPromptModal.hidden = true;
}

function dismissInstallPrompt() {
  localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, String(Date.now()));
  closeInstallPrompt();
}

async function confirmInstallPrompt() {
  if (!state.deferredInstallPrompt) {
    ui.installFallbackCopy.hidden = false;
    setStatus(ui.installPromptStatus, "Use your browser menu to add GIG FLOW to your home screen.");
    return;
  }

  const promptEvent = state.deferredInstallPrompt;
  state.deferredInstallPrompt = null;
  ui.installPromptButton.disabled = true;
  setStatus(ui.installPromptStatus, "Opening install sheet...");

  try {
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === "accepted") {
      localStorage.setItem(INSTALL_PROMPT_ACCEPTED_KEY, String(Date.now()));
      setStatus(ui.installPromptStatus, "Install accepted.", "success");
      closeInstallPrompt();
    } else {
      localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, String(Date.now()));
      setStatus(ui.installPromptStatus, "Install dismissed.");
      closeInstallPrompt();
    }
  } catch (error) {
    console.error("Install prompt failed.", error);
    setStatus(ui.installPromptStatus, "Install prompt was not available.", "error");
  } finally {
    ui.installPromptButton.disabled = false;
  }
}

function isPwaInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

function renderOcrReview(parsed) {
  ui.ocrReview.hidden = false;
  ui.ocrPlatformConfirm.value = parsed.platform || ui.platform.value || "";
  ui.ocrEarningsConfirm.value = Number.isFinite(parsed.grossAmount) ? parsed.grossAmount.toFixed(2) : "";
  ui.ocrMilesConfirm.value = Number.isFinite(parsed.miles) ? parsed.miles.toFixed(1) : "";
  ui.ocrPassengerFare.value = "";
  ui.dataUnionConsent.checked = false;
  setStatus(ui.dataUnionStatus);
}

function applyOcrConfirmationFromUi() {
  const parsed = {
    ...(state.lastOcrParsed || {}),
    platform: ui.ocrPlatformConfirm.value.trim(),
    grossAmount: numberValue(ui.ocrEarningsConfirm),
    miles: numberValue(ui.ocrMilesConfirm)
  };

  state.lastOcrParsed = parsed;
  applyParsedOffer(parsed);
  renderOcrResult(parsed);
  setStatus(ui.dataUnionStatus, "Confirmed values applied to the calculator.", "success");
}

async function submitDataUnionFromUi() {
  if (!state.authUser) {
    setStatus(ui.dataUnionStatus, "Sign in before submitting anonymized data.", "error");
    return;
  }

  if (!ui.dataUnionConsent.checked) {
    setStatus(ui.dataUnionStatus, "Consent is required before submitting.", "error");
    return;
  }

  const passengerFareEstimate = numberValue(ui.ocrPassengerFare);
  if (passengerFareEstimate <= 0) {
    setStatus(ui.dataUnionStatus, "Enter the passenger fare estimate first.", "error");
    return;
  }

  const ocrPayload = {
    platform: ui.ocrPlatformConfirm.value.trim(),
    grossAmount: numberValue(ui.ocrEarningsConfirm),
    miles: numberValue(ui.ocrMilesConfirm),
    passengerFareEstimate
  };

  const tripContext = {
    platform: ocrPayload.platform,
    distanceMiles: ocrPayload.miles,
    observedAtStart: new Date().toISOString()
  };

  ui.submitDataUnionButton.disabled = true;
  setStatus(ui.dataUnionStatus, "Submitting anonymized trip economics...");

  try {
    const submitTrip = window.GigFlow?.submitDataUnionTrip || submitDataUnionTrip;
    await submitTrip(ocrPayload, tripContext, {
      consent: true,
      ingestToken: window.GIG_FLOW_DRIVER_INGEST_TOKEN || ""
    });
    setStatus(ui.dataUnionStatus, "Anonymized trip submitted.", "success");
  } catch (error) {
    console.error("Data Union submission failed.", error);
    setStatus(ui.dataUnionStatus, error.message, "error");
  } finally {
    ui.submitDataUnionButton.disabled = false;
  }
}

function clearShiftInputs() {
  [
    ui.basePay,
    ui.tips,
    ui.promo,
    ui.activeMiles,
    ui.deadheadMiles,
    ui.waitMinutes,
    ui.startTime,
    ui.endTime
  ].forEach((element) => {
    element.value = "";
  });
  updateCalculator();
}

async function archiveShift() {
  if (!state.authUser) {
    setStatus(ui.shiftStatus, "Sign in before archiving shifts.", "error");
    return;
  }

  const calc = updateCalculator();
  if (calc.gross <= 0) {
    setStatus(ui.shiftStatus, "Enter earnings before archiving.", "error");
    return;
  }

  setStatus(ui.shiftStatus, "Saving shift...");
  const now = Date.now();
  const shift = {
    uid: state.authUser.uid,
    timestamp: now,
    date: new Date(now).toISOString().slice(0, 10),
    displayDate: displayDate(now),
    platform: ui.platform.value,
    plat: ui.platform.value,
    gross: calc.gross.toFixed(2),
    base_pay: calc.basePay.toFixed(2),
    tips: calc.tips.toFixed(2),
    surge_bonus: calc.promo.toFixed(2),
    profit: calc.profit.toFixed(2),
    miles: calc.miles.toFixed(1),
    active_miles: calc.activeMiles,
    deadhead_miles: calc.deadheadMiles,
    wait_time: calc.waitMinutes,
    hours: calc.hours,
    startTime: ui.startTime.value || null,
    endTime: ui.endTime.value || null,
    gas_cost: calc.gasCost.toFixed(2),
    maint_cost: calc.maintenanceCost.toFixed(2),
    vehicle: {
      gasPrice: calc.gasPrice,
      mpg: calc.mpg,
      maintenanceRate: calc.maintenanceRate
    }
  };

  try {
    const docRef = await addDoc(collection(db, "shifts"), shift);
    state.shifts.unshift(normalizeShift(docRef.id, shift));
    clearShiftInputs();
    setStatus(ui.shiftStatus, "Shift archived.", "success");
    if (state.activeTab === "history") renderHistory();
  } catch (error) {
    console.error("Shift save failed.", error);
    setStatus(ui.shiftStatus, error.message, "error");
  }
}

function normalizeShift(id, data) {
  const timestamp = Number(data.timestamp) || Date.parse(data.date) || Date.now();
  return {
    id,
    uid: data.uid,
    timestamp,
    date: data.displayDate || displayDate(timestamp),
    platform: data.platform || data.plat || "Unknown",
    gross: parseFloat(data.gross) || 0,
    basePay: parseFloat(data.base_pay ?? data.gross) || 0,
    tips: parseFloat(data.tips) || 0,
    promo: parseFloat(data.surge_bonus) || 0,
    profit: parseFloat(data.profit) || 0,
    miles: parseFloat(data.miles) || 0,
    activeMiles: parseFloat(data.active_miles) || 0,
    deadheadMiles: parseFloat(data.deadhead_miles) || 0,
    waitMinutes: parseFloat(data.wait_time) || 0,
    hours: parseFloat(data.hours) || 0,
    gasCost: parseFloat(data.gas_cost) || 0,
    maintenanceCost: parseFloat(data.maint_cost) || 0
  };
}

async function fetchShifts() {
  if (!state.authUser) return [];
  const q = query(collection(db, "shifts"), where("uid", "==", state.authUser.uid));
  const snapshot = await getDocs(q);
  state.shifts = snapshot.docs.map((item) => normalizeShift(item.id, item.data()));
  return state.shifts;
}

function filteredShifts() {
  let shifts = [...state.shifts];

  if (state.filters.platform !== "All") {
    shifts = shifts.filter((shift) => shift.platform === state.filters.platform);
  }

  shifts.sort((a, b) => b.timestamp - a.timestamp);
  if (state.filters.sort === "oldest") shifts.reverse();
  if (state.filters.sort === "profitHigh") shifts.sort((a, b) => b.profit - a.profit);
  if (state.filters.sort === "profitLow") shifts.sort((a, b) => a.profit - b.profit);

  return shifts;
}

async function loadHistory() {
  ui.historyList.innerHTML = `<div class="empty-state">Syncing cloud shifts...</div>`;
  try {
    await fetchShifts();
    renderHistory();
  } catch (error) {
    console.error("Shift history failed.", error);
    ui.historyList.innerHTML = `<div class="empty-state">Unable to load shifts.</div>`;
  }
}

function renderHistory() {
  const shifts = filteredShifts();
  ui.filterStatus.textContent = state.filters.platform === "All"
    ? "Showing: All Shifts"
    : `Showing: ${state.filters.platform}`;

  if (!shifts.length) {
    ui.historyList.innerHTML = `<div class="empty-state">No shifts found.</div>`;
    return;
  }

  ui.historyList.innerHTML = shifts.map((shift) => `
    <article class="list-item">
      <div>
        <div class="list-title">${escapeHtml(shift.platform)}</div>
        <div class="list-meta">${escapeHtml(shift.date)} | ${currency(shift.gross)} gross | ${shift.miles.toFixed(1)} mi</div>
      </div>
      <strong class="list-value">+${currency(shift.profit)}</strong>
    </article>
  `).join("");
}

function normalizeExpense(id, data) {
  const timestamp = Number(data.timestamp) || Date.parse(data.date) || Date.now();
  return {
    id,
    uid: data.uid,
    timestamp,
    date: data.date || displayDate(timestamp),
    amount: parseFloat(data.amount) || 0,
    category: data.category || "Maintenance",
    odometer: data.odometer || "",
    notes: data.notes || "",
    isShared: data.is_shared !== false
  };
}

async function fetchExpenses() {
  if (!state.authUser) return [];
  const q = query(collection(db, "expenses"), where("uid", "==", state.authUser.uid));
  const snapshot = await getDocs(q);
  state.expenses = snapshot.docs.map((item) => normalizeExpense(item.id, item.data()));
  return state.expenses;
}

async function loadVault() {
  ui.vaultList.innerHTML = `<div class="empty-state">Loading vault...</div>`;
  try {
    await fetchExpenses();
    renderVault();
  } catch (error) {
    console.error("Vault load failed.", error);
    ui.vaultList.innerHTML = `<div class="empty-state">Unable to load expenses.</div>`;
  }
}

function renderVault() {
  const currentYear = new Date().getFullYear();
  const currentYearTotal = state.expenses.reduce((total, expense) => {
    const year = new Date(expense.timestamp).getFullYear();
    const isVehicleCost = expense.category === "Maintenance" || expense.category === "Insurance";
    return year === currentYear && isVehicleCost ? total + expense.amount : total;
  }, 0);

  ui.vaultYearTotal.textContent = currency(currentYearTotal);

  const expenses = [...state.expenses].sort((a, b) => b.timestamp - a.timestamp);
  if (!expenses.length) {
    ui.vaultList.innerHTML = `<div class="empty-state">No expenses logged yet.</div>`;
    return;
  }

  ui.vaultList.innerHTML = expenses.map((expense) => `
    <article class="list-item warning">
      <div>
        <div class="list-title">${escapeHtml(expense.category)}</div>
        <div class="list-meta">${escapeHtml(expense.date)}${expense.odometer ? ` | Odometer: ${escapeHtml(expense.odometer)}` : ""}</div>
        <div class="list-meta">${escapeHtml(expense.notes || "No notes")}</div>
      </div>
      <div>
        <strong class="list-value expense">-${currency(expense.amount)}</strong>
        <div class="row-actions">
          <button class="mini-button" type="button" data-action="edit-expense" data-expense-id="${escapeHtml(expense.id)}">Edit</button>
          <button class="mini-button danger" type="button" data-action="delete-expense" data-expense-id="${escapeHtml(expense.id)}">Delete</button>
        </div>
      </div>
    </article>
  `).join("");
}

function clearExpenseForm() {
  ui.vaultEditId.value = "";
  ui.vaultDate.value = todayInputValue();
  ui.vaultAmount.value = "";
  ui.vaultCategory.value = "Maintenance";
  ui.vaultOdometer.value = "";
  ui.vaultNotes.value = "";
  document.querySelector('[data-action="cancel-expense-edit"]').hidden = true;
  setStatus(ui.vaultStatus);
}

async function saveExpense() {
  if (!state.authUser) {
    setStatus(ui.vaultStatus, "Sign in before saving expenses.", "error");
    return;
  }

  const date = ui.vaultDate.value;
  const amount = numberValue(ui.vaultAmount);
  if (!date || amount <= 0) {
    setStatus(ui.vaultStatus, "Enter a date and cost.", "error");
    return;
  }

  const timestamp = timestampFromDateInput(date);
  const expense = {
    uid: state.authUser.uid,
    timestamp,
    date: displayDate(timestamp),
    amount: amount.toFixed(2),
    category: ui.vaultCategory.value,
    odometer: ui.vaultOdometer.value.trim() || null,
    notes: ui.vaultNotes.value.trim(),
    is_shared: true,
    updatedAt: Date.now()
  };

  const editId = ui.vaultEditId.value;
  setStatus(ui.vaultStatus, editId ? "Updating expense..." : "Saving expense...");

  try {
    if (editId) {
      await updateDoc(doc(db, "expenses", editId), expense);
      state.expenses = state.expenses.map((item) => item.id === editId ? normalizeExpense(editId, expense) : item);
      setStatus(ui.vaultStatus, "Expense updated.", "success");
    } else {
      const docRef = await addDoc(collection(db, "expenses"), {
        ...expense,
        createdAt: Date.now()
      });
      state.expenses.unshift(normalizeExpense(docRef.id, expense));
      setStatus(ui.vaultStatus, "Expense saved.", "success");
    }

    clearExpenseForm();
    renderVault();
  } catch (error) {
    console.error("Expense save failed.", error);
    setStatus(ui.vaultStatus, error.message, "error");
  }
}

function editExpense(expenseId) {
  const expense = state.expenses.find((item) => item.id === expenseId);
  if (!expense) return;

  ui.vaultEditId.value = expense.id;
  ui.vaultDate.value = new Date(expense.timestamp).toISOString().slice(0, 10);
  ui.vaultAmount.value = expense.amount.toFixed(2);
  ui.vaultCategory.value = expense.category;
  ui.vaultOdometer.value = expense.odometer || "";
  ui.vaultNotes.value = expense.notes || "";
  document.querySelector('[data-action="cancel-expense-edit"]').hidden = false;
  setStatus(ui.vaultStatus, "Editing expense.");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteExpenseById(expenseId) {
  const expense = state.expenses.find((item) => item.id === expenseId);
  if (!expense) return;

  const ok = window.confirm(`Delete ${expense.category} expense for ${currency(expense.amount)}?`);
  if (!ok) return;

  try {
    await deleteDoc(doc(db, "expenses", expenseId));
    state.expenses = state.expenses.filter((item) => item.id !== expenseId);
    renderVault();
  } catch (error) {
    console.error("Expense delete failed.", error);
    setStatus(ui.vaultStatus, error.message, "error");
  }
}

async function loadAnalytics() {
  ui.analyticsSummary.innerHTML = `<div class="empty-state">Crunching data...</div>`;
  try {
    await Promise.all([fetchShifts(), fetchExpenses()]);
    renderAnalytics();
  } catch (error) {
    console.error("Analytics load failed.", error);
    ui.analyticsSummary.innerHTML = `<div class="empty-state">Unable to load analytics.</div>`;
  }
}

function buildAggregates() {
  const aggregates = {};
  let totalMiles = 0;

  state.shifts.forEach((shift) => {
    if (!aggregates[shift.platform]) {
      aggregates[shift.platform] = {
        profit: 0,
        gross: 0,
        hours: 0,
        waitMinutes: 0,
        miles: 0,
        basePay: 0,
        tips: 0,
        promo: 0
      };
    }

    const bucket = aggregates[shift.platform];
    bucket.profit += shift.profit;
    bucket.gross += shift.gross;
    bucket.hours += shift.hours;
    bucket.waitMinutes += shift.waitMinutes;
    bucket.miles += shift.miles;
    bucket.basePay += shift.basePay;
    bucket.tips += shift.tips;
    bucket.promo += shift.promo;
    totalMiles += shift.miles;
  });

  const sharedExpenses = state.expenses.reduce((total, expense) => total + expense.amount, 0);
  Object.values(aggregates).forEach((bucket) => {
    const share = totalMiles > 0 ? bucket.miles / totalMiles : 0;
    bucket.profit -= sharedExpenses * share;
  });

  return aggregates;
}

function renderAnalytics() {
  const aggregates = buildAggregates();
  const platforms = Object.keys(aggregates);

  if (!platforms.length) {
    ui.analyticsSummary.innerHTML = `<div class="empty-state">No shift data to analyze.</div>`;
    destroyCharts();
    return;
  }

  ui.analyticsSummary.innerHTML = `
    <table class="analytics-table">
      <thead>
        <tr>
          <th>Platform</th>
          <th>Profit</th>
          <th>Rate</th>
          <th>Per Mile</th>
        </tr>
      </thead>
      <tbody>
        ${platforms.map((platform) => {
    const data = aggregates[platform];
    const totalHours = data.hours + data.waitMinutes / 60;
    const hourly = totalHours > 0 ? data.profit / totalHours : 0;
    const perMile = data.miles > 0 ? data.profit / data.miles : 0;
    return `
            <tr>
              <td>${escapeHtml(platform)}</td>
              <td class="positive">${currency(data.profit)}</td>
              <td>${currency(hourly)}/hr</td>
              <td>${currency(perMile)}/mi</td>
            </tr>
          `;
  }).join("")}
      </tbody>
    </table>
  `;

  renderCharts(platforms, aggregates);
}

function destroyCharts() {
  if (state.charts.profit) state.charts.profit.destroy();
  if (state.charts.breakdown) state.charts.breakdown.destroy();
  state.charts.profit = null;
  state.charts.breakdown = null;
}

function renderCharts(platforms, aggregates) {
  if (!window.Chart) {
    setStatus(ui.analyticsStatus, "Charts are still loading.");
    return;
  }

  destroyCharts();

  const sharedOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: "#91a3b8" }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "#91a3b8" }
      },
      y: {
        beginAtZero: true,
        grid: { color: "#26384f" },
        ticks: { color: "#91a3b8" }
      }
    }
  };

  state.charts.profit = new window.Chart(ui.profitChart.getContext("2d"), {
    type: "bar",
    data: {
      labels: platforms,
      datasets: [{
        label: "Net Profit",
        data: platforms.map((platform) => aggregates[platform].profit),
        backgroundColor: "#38bdf8",
        borderRadius: 6
      }]
    },
    options: {
      ...sharedOptions,
      plugins: {
        legend: { display: false }
      }
    }
  });

  state.charts.breakdown = new window.Chart(ui.breakdownChart.getContext("2d"), {
    type: "bar",
    data: {
      labels: platforms,
      datasets: [
        {
          label: "Base",
          data: platforms.map((platform) => aggregates[platform].basePay),
          backgroundColor: "#38bdf8",
          borderRadius: 4
        },
        {
          label: "Tips",
          data: platforms.map((platform) => aggregates[platform].tips),
          backgroundColor: "#4ade80",
          borderRadius: 4
        },
        {
          label: "Promo",
          data: platforms.map((platform) => aggregates[platform].promo),
          backgroundColor: "#fbbf24",
          borderRadius: 4
        }
      ]
    },
    options: {
      ...sharedOptions,
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: "#91a3b8" }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: "#26384f" },
          ticks: { color: "#91a3b8" }
        }
      }
    }
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function exportTaxCsv() {
  const canExport = await ensurePremiumAccess();
  if (!canExport) return;

  await Promise.all([fetchShifts(), fetchExpenses()]);

  const year = ui.exportYear.value;
  const mileageRate = TAX_MILEAGE_RATES[year] || TAX_MILEAGE_RATES["2026"];

  const yearShifts = state.shifts.filter((shift) => new Date(shift.timestamp).getFullYear().toString() === year);
  const yearExpenses = state.expenses.filter((expense) => new Date(expense.timestamp).getFullYear().toString() === year);

  const totalGross = yearShifts.reduce((total, shift) => total + shift.gross, 0);
  const totalMiles = yearShifts.reduce((total, shift) => total + shift.miles, 0);
  const supplies = yearExpenses
    .filter((expense) => expense.category === "Supplies")
    .reduce((total, expense) => total + expense.amount, 0);
  const other = yearExpenses
    .filter((expense) => !["Maintenance", "Insurance", "Supplies"].includes(expense.category))
    .reduce((total, expense) => total + expense.amount, 0);
  const carExpenses = totalMiles * mileageRate;
  const netProfit = totalGross - carExpenses - supplies - other;

  const rows = [
    ["Category", "Amount ($)", "Notes"],
    ["Total Gross Receipts", totalGross.toFixed(2), ""],
    ["Car and Truck Expenses", carExpenses.toFixed(2), `Standard mileage deduction: ${totalMiles.toFixed(1)} miles at $${mileageRate.toFixed(3)}/mi`],
    ["Supplies", supplies.toFixed(2), ""],
    ["Other Business Expenses", other.toFixed(2), ""],
    ["Net Profit", netProfit.toFixed(2), ""]
  ];

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `GIG_FLOW_Schedule_C_${year}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(ui.analyticsStatus, "Tax CSV downloaded.", "success");
}

function renderAdPanel() {
  if (!ui.adPanel) return;
  ui.adPanel.hidden = state.isPremium;
}

async function enablePushTracking(options = {}) {
  if (!state.authUser) {
    throw new Error("Sign in before enabling push tracking.");
  }

  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
    throw new Error("This browser does not support Web Push for PWAs.");
  }

  const vapidPublicKey = options.vapidPublicKey || window.GIG_FLOW_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    throw new Error("Missing VAPID public key. Set window.GIG_FLOW_VAPID_PUBLIC_KEY before enabling push tracking.");
  }

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("Notifications are required for background push tracking.");
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
  });

  const apiBase = options.apiBase || window.GIG_FLOW_PUSH_API_BASE || "";
  await postJson(`${apiBase}/api/push/subscribe`, {
    uid: state.authUser.uid,
    subscription
  });

  await writeTrackingState({
    uid: state.authUser.uid,
    pushEnabled: true,
    staleAfterMs: options.staleAfterMs || DEFAULT_TRACKING_STALE_MS
  });

  return subscription;
}

async function startShiftTracking(options = {}) {
  if (!state.authUser) {
    throw new Error("Sign in before starting shift tracking.");
  }

  const apiBase = options.apiBase || window.GIG_FLOW_PUSH_API_BASE || "";
  const vapidPublicKey = options.vapidPublicKey
    || window.GIG_FLOW_VAPID_PUBLIC_KEY
    || await fetchVapidPublicKey(apiBase);

  await enablePushTracking({
    ...options,
    apiBase,
    vapidPublicKey
  });

  await startForegroundTracking({
    geofences: options.geofences || [],
    routeWindows: options.routeWindows || [],
    staleAfterMs: options.staleAfterMs || DEFAULT_TRACKING_STALE_MS
  });

  await postJson(`${apiBase}/api/push/tracking/start`, {
    uid: state.authUser.uid,
    intervalMs: options.intervalMs || 3 * 60 * 1000,
    payload: {
      geofences: options.geofences || [],
      routeWindows: options.routeWindows || [],
      staleAfterMs: options.staleAfterMs || DEFAULT_TRACKING_STALE_MS
    }
  }, options.adminToken);
}

async function endShiftTracking(options = {}) {
  if (!state.authUser) {
    throw new Error("Sign in before ending shift tracking.");
  }

  const apiBase = options.apiBase || window.GIG_FLOW_PUSH_API_BASE || "";
  await stopForegroundTracking();
  await postJson(`${apiBase}/api/push/tracking/stop`, {
    uid: state.authUser.uid
  }, options.adminToken);
}

async function syncCoopDriverTelemetry(options = {}) {
  if (!state.authUser) {
    throw new Error("Sign in before syncing co-op telemetry.");
  }

  const apiBase = options.apiBase || window.GIG_FLOW_PUSH_API_BASE || "";
  const lastKnownLocation = options.location || (await readTrackingState())?.lastKnownLocation;

  return postJson(`${apiBase}/api/internal/v1/driver-telemetry`, {
    uid: state.authUser.uid,
    status: options.status || "ON_SHIFT",
    partnerId: options.partnerId || null,
    location: lastKnownLocation || null,
    vehicleCapacity: options.vehicleCapacity || {}
  }, options.internalToken);
}

async function submitDataUnionTrip(ocrPayload, tripContext = {}, options = {}) {
  if (!state.authUser) {
    throw new Error("Sign in before submitting a Data Union trip.");
  }

  if (!options.consent) {
    throw new Error("Driver consent is required before submitting anonymized trip data.");
  }

  const apiBase = options.apiBase || window.GIG_FLOW_PUSH_API_BASE || "";
  return postJson(`${apiBase}/api/data-union/ingest`, {
    consent: true,
    driverSubject: options.driverSubject || undefined,
    ocr: ocrPayload,
    trip: tripContext
  }, options.ingestToken);
}

async function startForegroundTracking(options = {}) {
  if (!("geolocation" in navigator)) {
    throw new Error("Geolocation is not available in this browser.");
  }

  const geofences = Array.isArray(options.geofences) ? options.geofences : [];
  const routeWindows = Array.isArray(options.routeWindows) ? options.routeWindows : [];

  await writeTrackingState({
    uid: state.authUser?.uid || null,
    active: true,
    geofences,
    routeWindows,
    staleAfterMs: options.staleAfterMs || DEFAULT_TRACKING_STALE_MS
  });

  if (state.geoWatchId !== null) {
    navigator.geolocation.clearWatch(state.geoWatchId);
  }

  state.geoWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      await writeTrackingState({
        lastKnownLocation: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: position.timestamp || Date.now()
        }
      });
    },
    (error) => {
      console.warn("Foreground geolocation tracking failed.", error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 30_000,
      timeout: 20_000
    }
  );

  return state.geoWatchId;
}

async function stopForegroundTracking() {
  if (state.geoWatchId !== null && "geolocation" in navigator) {
    navigator.geolocation.clearWatch(state.geoWatchId);
  }

  state.geoWatchId = null;
  await writeTrackingState({ active: false });
}

async function saveGigGeofences(geofences = [], routeWindows = []) {
  return writeTrackingState({
    geofences,
    routeWindows
  });
}

function switchVisibleTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === tabName);
  });
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });
}

async function switchTab(tabName) {
  if (!state.authUser) return;

  if (PREMIUM_TABS.has(tabName)) {
    const hasAccess = await ensurePremiumAccess();
    if (!hasAccess) return;
  }

  switchVisibleTab(tabName);

  if (tabName === "history") await loadHistory();
  if (tabName === "vault") await loadVault();
  if (tabName === "analytics") await loadAnalytics();
}

function setDefaultDates() {
  if (!ui.vaultDate.value) {
    ui.vaultDate.value = todayInputValue();
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    const registration = await navigator.serviceWorker.register("./sw.js");
    registration.update();
  } catch (error) {
    console.warn("Service worker registration failed.", error);
  }
}

function bindInstallPromptEvents() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    localStorage.setItem(INSTALL_PROMPT_ACCEPTED_KEY, String(Date.now()));
    closeInstallPrompt();
  });
}

function handleServiceWorkerMessage(event) {
  const message = event.data || {};

  if (message.type === "GIGFLOW_SHARE_IMAGE_READY") {
    handleSharedOfferImage(message.shareId);
    return;
  }

  if (message.type === "GIGFLOW_TRACKING_RESULT") {
    console.info("GIG FLOW tracking wake result", message.result);
  }
}

function processLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  const shareId = params.get("shareId");
  const shareError = params.get("shareError");

  if (shareId) {
    handleSharedOfferImage(shareId);
  }

  if (shareError) {
    ui.offerOcrPanel.hidden = false;
    setStatus(ui.ocrStatus, "GIG FLOW could not read the shared screenshot.", "error");
  }

  if (shareId || shareError || params.has("tracking")) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

function bindEvents() {
  ui.authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    login();
  });

  document.querySelectorAll("[data-calc-input]").forEach((element) => {
    element.addEventListener("input", updateCalculator);
  });

  ui.filterBackdrop.addEventListener("click", closeFilter);
  ui.paywallBackdrop.addEventListener("click", closePaywall);
  ui.installPromptBackdrop.addEventListener("click", dismissInstallPrompt);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFilter();
      closePaywall();
    }
  });

  document.addEventListener("click", async (event) => {
    const planButton = event.target.closest("[data-plan-id]");
    if (planButton) {
      state.selectedPlanId = planButton.dataset.planId;
      renderPaywallPlans();
      return;
    }

    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) {
      await switchTab(tabButton.dataset.tab);
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const action = actionButton.dataset.action;
    const expenseId = actionButton.dataset.expenseId;

    if (action === "login") await login();
    if (action === "signup") await signup();
    if (action === "logout") await logout();
    if (action === "archive-shift") await archiveShift();
    if (action === "toggle-shift-tracking") await toggleShiftTrackingFromUi();
    if (action === "apply-ocr-confirmation") applyOcrConfirmationFromUi();
    if (action === "submit-data-union") await submitDataUnionFromUi();
    if (action === "open-filter") openFilter();
    if (action === "apply-filter") applyFilter();
    if (action === "reset-filter") resetFilter();
    if (action === "save-expense") await saveExpense();
    if (action === "cancel-expense-edit") clearExpenseForm();
    if (action === "edit-expense") editExpense(expenseId);
    if (action === "delete-expense") await deleteExpenseById(expenseId);
    if (action === "export-tax") await exportTaxCsv();
    if (action === "close-paywall") closePaywall();
    if (action === "subscribe") await subscribeSelectedPlan();
    if (action === "dismiss-install-prompt") dismissInstallPrompt();
    if (action === "confirm-install-prompt") await confirmInstallPrompt();
  });
}

function init() {
  cacheElements();
  bindInstallPromptEvents();
  bindEvents();
  setDefaultDates();
  renderPaywallPlans();
  updateCalculator();
  renderTrackingState();
  registerServiceWorker();
  processLaunchParams();
  onAuthStateChanged(auth, handleAuthChange);

  window.GigFlow = {
    fetchOfferings: () => fetchRevenueCatOfferings(),
    openPaywall,
    handleSharedOfferImage,
    enablePushTracking,
    startShiftTracking,
    endShiftTracking,
    syncCoopDriverTelemetry,
    submitDataUnionTrip,
    showOcrResultForReview: (parsed) => {
      ui.offerOcrPanel.hidden = false;
      state.lastOcrParsed = parsed || null;
      applyParsedOffer(parsed || {});
      renderOcrResult(parsed || {});
    },
    startForegroundTracking,
    stopForegroundTracking,
    saveGigGeofences,
    state
  };
}

init();

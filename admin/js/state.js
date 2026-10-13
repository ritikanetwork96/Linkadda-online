import { db, ref, onValue, get, set, update, remove, auth, onAuthStateChanged, query, limitToLast } from './firebase.js';
import { RTDB_NODES } from './config.js';
import { safeJson, slugify, uid } from './utils.js';

if (typeof window !== 'undefined' && window.location.pathname.endsWith('.js')) {
  window.location.replace('/admin');
}

const CACHE_KEY = 'linkadda_admin_store_cache_v4';
const DELETED_ORDERS_KEY = 'linkadda_deleted_order_ids_v1';

export function getDeletedOrderIds() {
  try {
    const raw = localStorage.getItem(DELETED_ORDERS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.map(String));
    }
  } catch (_) {}
  return new Set();
}

export function markOrderDeleted(id) {
  if (!id) return;
  try {
    const set = getDeletedOrderIds();
    set.add(String(id));
    localStorage.setItem(DELETED_ORDERS_KEY, JSON.stringify(Array.from(set)));
  } catch (_) {}
}

function loadCachedStore() {
  const initial = {
    hero: {},
    categories: {},
    products: {},
    events: {},
    banner: {},
    faq: {},
    testimonials: {},
    settings: {},
    payment: {},
    orders: {},
    analytics: {},
    media: {},
    visitors: {},
    customers: {},
  };

  // 1. Seed from window.__preloadedCatalog immediately (instant 0ms bootstrap)
  try {
    const preCatalog = (typeof window !== 'undefined' && window.__preloadedCatalog) ? window.__preloadedCatalog : null;
    if (preCatalog && typeof preCatalog === 'object') {
      ['products', 'categories', 'banner', 'hero', 'faq', 'testimonials'].forEach((k) => {
        if (preCatalog[k] && typeof preCatalog[k] === 'object' && Object.keys(preCatalog[k]).length > 0) {
          initial[k] = { ...preCatalog[k] };
        }
      });
    }
  } catch (_) {}

  // 2. Merge from live storefront cache if available
  try {
    const rawLive = localStorage.getItem('linkadda_cached_live_data');
    if (rawLive) {
      const parsedLive = JSON.parse(rawLive);
      if (parsedLive && typeof parsedLive === 'object') {
        ['products', 'categories', 'banner'].forEach((k) => {
          if (parsedLive[k] && typeof parsedLive[k] === 'object' && Object.keys(parsedLive[k]).length > 0) {
            initial[k] = { ...(initial[k] || {}), ...parsedLive[k] };
          }
        });
      }
    }
  } catch (_) {}

  // 3. Merge from admin's own saved cache (if it contains actual data)
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.keys(initial).forEach((k) => {
          if (parsed[k] && typeof parsed[k] === 'object' && Object.keys(parsed[k]).length > 0) {
            initial[k] = { ...(initial[k] || {}), ...parsed[k] };
          }
        });
      }
    }
  } catch (_) {}

  // 3b. Merge customer checkout orders from local storage as reliable fallback
  try {
    const rawUserOrders = localStorage.getItem('linkadda_user_orders');
    if (rawUserOrders) {
      const userOrders = JSON.parse(rawUserOrders);
      if (Array.isArray(userOrders)) {
        if (!initial.orders || typeof initial.orders !== 'object') initial.orders = {};
        userOrders.forEach((o) => {
          if (o && (o.orderId || o.id)) {
            const oid = String(o.orderId || o.id);
            if (!initial.orders[oid]) {
              initial.orders[oid] = { id: oid, orderId: oid, ...o };
            }
          }
        });
      }
    }
  } catch (_) {}

  // 4. Sanitize store branding to prevent JaiGram crossover
  try {
    if (initial.settings && typeof initial.settings === 'object') {
      if (!initial.settings.siteName || /jaigram|jai/i.test(initial.settings.siteName)) {
        initial.settings.siteName = 'Linkadda Online';
      }
    }
    // Clean up any legacy JaiGram keys from localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /jaigram/i.test(k)) {
        localStorage.removeItem(k);
      }
    }
  } catch (_) {}

  // 5. Clean up any corrupt slash keys (e.g. from previous batch updates)
  try {
    ['products', 'categories'].forEach((k) => {
      if (initial[k] && typeof initial[k] === 'object') {
        Object.keys(initial[k]).forEach((subKey) => {
          if (subKey.includes('/')) {
            delete initial[k][subKey];
          }
        });
      }
    });
  } catch (_) {}

  return initial;
}

const STORE = loadCachedStore();
const subscribers = new Set();
const activeUnsubs = new Map();
let emitTimer = null;
let saveCacheTimer = null;

function syncWebsiteCache() {
  try {
    const liveCache = {
      categories: STORE.categories || {},
      products: STORE.products || {},
      banner: STORE.banner || {},
      timestamp: Date.now(),
    };
    localStorage.setItem('linkadda_cached_live_data', JSON.stringify(liveCache));
    localStorage.setItem('linkadda_cached_live_data_v5', JSON.stringify(liveCache));
    localStorage.setItem('linkadda_cached_live_data_v4', JSON.stringify(liveCache));
    if (STORE.payment) {
      localStorage.setItem('linkadda_payment_payment', JSON.stringify(STORE.payment));
    }
    if (STORE.settings) {
      localStorage.setItem('linkadda_payment_settings', JSON.stringify(STORE.settings));
    }
    if (STORE.faq) {
      localStorage.setItem('linkadda_cached_faq', JSON.stringify(STORE.faq));
    }
  } catch (_) {}
}

function saveStoreCache() {
  if (saveCacheTimer) return;
  saveCacheTimer = setTimeout(() => {
    saveCacheTimer = null;
    try {
      const updatedCache = {
        settings: STORE.settings || {},
        payment: STORE.payment || {},
        hero: STORE.hero || {},
        banner: STORE.banner || {},
        faq: STORE.faq || {},
        testimonials: STORE.testimonials || {},
        categories: STORE.categories || {},
        products: STORE.products || {},
        orders: STORE.orders || {},
        events: STORE.events || {},
        visitors: STORE.visitors || {},
        customers: STORE.customers || {},
        analytics: STORE.analytics || {},
        timestamp: Date.now(),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(updatedCache));
      syncWebsiteCache();
    } catch (_) {}
  }, 250);
}

function emit() {
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = setTimeout(() => {
    emitTimer = null;
    requestAnimationFrame(() => {
      saveStoreCache();
      const snapshot = getSnapshot();
      subscribers.forEach((fn) => {
        try {
          fn(snapshot);
        } catch (err) {
          console.error('Subscriber error:', err);
        }
      });
    });
  }, 35);
}

export function emitImmediate() {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
  saveStoreCache();
  const snapshot = getSnapshot();
  subscribers.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (err) {
      console.error('Subscriber error:', err);
    }
  });
}

export function getSnapshot() {
  const copy = {};
  for (const k in STORE) {
    copy[k] = typeof STORE[k] === 'object' && STORE[k] !== null ? { ...STORE[k] } : STORE[k];
  }
  return copy;
}

export function subscribe(fn) {
  subscribers.add(fn);
  fn(getSnapshot());
  return () => subscribers.delete(fn);
}

function attachNode(key, mode = 'collection') {
  const nodeName = RTDB_NODES[key];
  if (!nodeName) return;

  // Clean up previous subscription if any
  if (activeUnsubs.has(key)) {
    try {
      activeUnsubs.get(key)();
    } catch (_) {}
    activeUnsubs.delete(key);
  }

  try {
    const targetRef = ref(db, nodeName);

    // ⚡ INSTANT HYDRATION: Fetch immediate snapshot in parallel with realtime subscription
    get(targetRef)
      .then((snap) => {
        if (snap.exists() && snap.val()) {
          const val = snap.val();
          if (['orders', 'visitors', 'events'].includes(key)) {
            if (!STORE[key] || typeof STORE[key] !== 'object') STORE[key] = {};
            if (val && typeof val === 'object') {
              STORE[key] = { ...val };
            }
            emitImmediate();
          } else if (typeof val === 'object' && Object.keys(val).length > 0) {
            STORE[key] = val;
            emitImmediate();
          } else if (mode === 'singleton') {
            STORE[key] = val;
            emitImmediate();
          }
        }
      })
      .catch(() => {});

    const unsub = onValue(
      targetRef,
      (snap) => {
        if (snap.exists() && snap.val()) {
          const val = snap.val();
          if (['orders', 'visitors', 'events'].includes(key)) {
            if (!STORE[key] || typeof STORE[key] !== 'object') STORE[key] = {};
            if (val && typeof val === 'object') {
              STORE[key] = { ...val };
            }
            emit();
          } else if (typeof val === 'object' && Object.keys(val).length > 0) {
            STORE[key] = val;
            emit();
          } else if (mode === 'singleton') {
            STORE[key] = val;
            emit();
          }
        } else {
          // Do not wipe critical catalog or transaction collections if snapshot is empty/unresolved
          if (!['orders', 'products', 'categories', 'events', 'visitors'].includes(key)) {
            if (mode === 'collection') {
              STORE[key] = {};
              emit();
            } else if (mode === 'singleton') {
              STORE[key] = null;
              emit();
            }
          }
        }
      },
      (err) => {
        console.warn(`RTDB node ${key} subscription notice:`, err?.message || err);
      }
    );
    activeUnsubs.set(key, unsub);
  } catch (err) {
    console.warn(`Attach node ${key} error:`, err);
  }
}

// Seamless on-demand fetch of all historical orders if requested by admin
export async function loadAllHistoricalOrders() {
  try {
    const snap = await get(ref(db, 'orders'));
    if (snap.exists() && snap.val()) {
      if (!STORE.orders || typeof STORE.orders !== 'object') STORE.orders = {};
      Object.assign(STORE.orders, snap.val());
      emitImmediate();
      return Object.keys(STORE.orders).length;
    }
  } catch (err) {
    console.warn('loadAllHistoricalOrders note:', err);
  }
  return 0;
}
if (typeof window !== 'undefined') {
  window.loadAllHistoricalOrders = loadAllHistoricalOrders;
}

let isRealtimeStarted = false;
export function startRealtime(force = false) {
  if (isRealtimeStarted && !force) return;
  isRealtimeStarted = true;
  attachNode('hero', 'singleton');
  attachNode('categories');
  attachNode('products');
  attachNode('events');
  attachNode('banner', 'singleton');
  attachNode('faq');
  attachNode('testimonials');
  attachNode('settings', 'singleton');
  attachNode('payment', 'singleton');
  attachNode('orders');
  attachNode('analytics', 'singleton');
  attachNode('media');
  attachNode('visitors');
  attachNode('reviews');
  attachNode('customers');
  // Proactively fetch complete fresh snapshot via REST as high-reliability fallback
  syncAllFromFirebase(force).catch(() => {});
}

export async function syncAllFromFirebase(force = false) {
  try {
    const targets = ['visitors', 'events', 'orders', 'products', 'categories', 'customers', 'payment', 'settings'];

    // 1. Try Firebase SDK get() on active connection
    let hasSdkChange = false;
    const sdkResults = await Promise.allSettled(
      targets.map(async (key) => {
        const snap = await get(ref(db, key));
        if (snap.exists() && snap.val()) {
          return { key, data: snap.val() };
        }
        return null;
      })
    );

    sdkResults.forEach((outcome) => {
      if (outcome.status === 'fulfilled' && outcome.value && outcome.value.data) {
        const { key, data } = outcome.value;
        if (typeof data === 'object' && Object.keys(data).length > 0) {
          if (['orders', 'visitors', 'events'].includes(key)) {
            if (!STORE[key] || typeof STORE[key] !== 'object') STORE[key] = {};
            STORE[key] = { ...data };
          } else {
            STORE[key] = data;
          }
          hasSdkChange = true;
        }
      }
    });

    if (hasSdkChange) {
      emitImmediate();
      return;
    }

    // 2. Direct REST Fallback
    let token = null;
    if (auth.currentUser) {
      try {
        token = await auth.currentUser.getIdToken();
      } catch (_) {}
    }
    const tokenQuery = token ? `?auth=${encodeURIComponent(token)}` : '';
    const base = 'https://linkadda-online-default-rtdb.firebaseio.com';

    const results = await Promise.allSettled(
      targets.map(async (key) => {
        const res = await fetch(`${base}/${key}.json${tokenQuery}`, { cache: 'no-store' });
        if (!res.ok) return null;
        return { key, data: await res.json() };
      })
    );

    let hasChange = false;
    results.forEach((outcome) => {
      if (outcome.status === 'fulfilled' && outcome.value && outcome.value.data && typeof outcome.value.data === 'object') {
        const { key, data } = outcome.value;
        const count = Object.keys(data).length;
        if (count > 0) {
          if (['orders', 'visitors', 'events'].includes(key)) {
            if (!STORE[key] || typeof STORE[key] !== 'object') STORE[key] = {};
            STORE[key] = { ...data };
          } else {
            STORE[key] = data;
          }
          hasChange = true;
        }
      }
    });

    if (hasChange) {
      emitImmediate();
    }
  } catch (err) {
    console.warn('syncAllFromFirebase warning:', err);
  }
}

// Proactively start listeners on load
startRealtime();

// Automatically bind listeners to auth state transitions
onAuthStateChanged(auth, (user) => {
  if (user) {
    startRealtime(true);
    syncAllFromFirebase(true).catch(() => {});
  }
});

function isSingleton(node) {
  return ['hero', 'banner', 'settings', 'payment', 'analytics'].includes(node);
}

function nodeRef(node, id = null) {
  if (!RTDB_NODES[node]) throw new Error(`Unknown node: ${node}`);
  return id ? ref(db, `${RTDB_NODES[node]}/${id}`) : ref(db, RTDB_NODES[node]);
}

export async function saveRecord(node, id, data) {
  const payload = {
    ...data,
    id: id || data.id || uid(node),
    updatedAt: Date.now(),
  };
  if (!payload.createdAt) payload.createdAt = Date.now();
  if (isSingleton(node)) {
    STORE[node] = payload;
    emitImmediate();
    syncWebsiteCache();
    await set(nodeRef(node), payload);
    return payload;
  }
  if (!STORE[node]) STORE[node] = {};
  STORE[node][payload.id] = payload;
  emitImmediate();
  syncWebsiteCache();
  await set(nodeRef(node, payload.id), payload);
  return payload;
}

export async function createRecord(node, data) {
  const payload = {
    ...data,
    id: data.id || uid(node),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (isSingleton(node)) {
    STORE[node] = payload;
    emitImmediate();
    syncWebsiteCache();
    await set(nodeRef(node), payload);
    return payload;
  }
  if (!STORE[node]) STORE[node] = {};
  STORE[node][payload.id] = payload;
  emitImmediate();
  syncWebsiteCache();
  await set(nodeRef(node, payload.id), payload);
  return payload;
}

export async function updateRecord(node, id, data) {
  if (isSingleton(node)) {
    const next = { ...(STORE[node] || {}), ...data, updatedAt: Date.now() };
    STORE[node] = next;
    emitImmediate();
    syncWebsiteCache();
    await set(nodeRef(node), next);
    return next;
  }
  let targetId = id;
  if (STORE[node] && !STORE[node][targetId]) {
    const foundKey = Object.keys(STORE[node]).find((k) => {
      const item = STORE[node][k];
      return item && (String(item.id) === String(id) || String(item.slug) === String(id));
    });
    if (foundKey) targetId = foundKey;
  }
  const current = STORE[node]?.[targetId] || {};
  const next = { ...current, ...data, id: current.id || targetId, updatedAt: Date.now() };
  if (!STORE[node]) STORE[node] = {};
  STORE[node][targetId] = next;
  emitImmediate();
  syncWebsiteCache();
  await update(nodeRef(node, targetId), { ...data, updatedAt: Date.now() });
  return next;
}

export async function updateRecordsBatch(node, batchMap) {
  const nodeName = RTDB_NODES[node];
  if (!nodeName) throw new Error(`Unknown node: ${node}`);
  if (!STORE[node]) STORE[node] = {};

  // Clean up any existing corrupted slash-keys in STORE
  for (const k of Object.keys(STORE[node])) {
    if (k.includes('/')) {
      delete STORE[node][k];
    }
  }

  // Properly apply batch updates in memory (handling multi-path slash keys e.g. "prodId/displayOrder")
  for (const [key, value] of Object.entries(batchMap || {})) {
    if (key.includes('/')) {
      const slashIndex = key.indexOf('/');
      const recordId = key.slice(0, slashIndex);
      const field = key.slice(slashIndex + 1);
      if (!STORE[node][recordId]) {
        STORE[node][recordId] = { id: recordId };
      }
      STORE[node][recordId][field] = value;
    } else {
      STORE[node][key] = { ...(STORE[node][key] || {}), ...(value || {}) };
    }
  }
  emitImmediate();
  syncWebsiteCache();
  await update(ref(db, nodeName), batchMap);
}

export async function deleteRecord(node, id) {
  if (isSingleton(node)) {
    delete STORE[node];
    emitImmediate();
    syncWebsiteCache();
    await set(nodeRef(node), null);
    return;
  }
  if (!id) {
    console.warn(`deleteRecord called on ${node} without valid id`);
    return;
  }

  let targetKey = id;
  let alternateId = null;

  if (node === 'orders') {
    markOrderDeleted(id);
    // Also clean linkadda_user_orders immediately
    try {
      const rawUserOrders = localStorage.getItem('linkadda_user_orders');
      if (rawUserOrders) {
        const arr = JSON.parse(rawUserOrders);
        if (Array.isArray(arr)) {
          const filtered = arr.filter((o) => o && String(o.id) !== String(id) && String(o.orderId) !== String(id));
          localStorage.setItem('linkadda_user_orders', JSON.stringify(filtered));
        }
      }
    } catch (_) {}
  }

  if (STORE[node]) {
    if (STORE[node][id]) {
      const item = STORE[node][id];
      if (item?.orderId) alternateId = item.orderId;
      delete STORE[node][id];
    } else {
      // Find matching key if id was an alternate identifier (e.g. orderId or slug)
      for (const k of Object.keys(STORE[node])) {
        const item = STORE[node][k];
        if (item && (String(item.id) === String(id) || String(item.orderId) === String(id) || String(item.slug) === String(id))) {
          if (item?.id) alternateId = item.id;
          if (item?.orderId) markOrderDeleted(item.orderId);
          delete STORE[node][k];
          targetKey = k;
          break;
        }
      }
    }
    if (alternateId) markOrderDeleted(alternateId);

    // Synchronously clean CACHE_KEY so refresh right after delete does not bring it back
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.[node]?.[targetKey]) {
          delete parsed[node][targetKey];
        }
        if (alternateId && parsed?.[node]?.[alternateId]) {
          delete parsed[node][alternateId];
        }
        localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
      }
    } catch (_) {}

    emitImmediate();
    syncWebsiteCache();
  }

  if (targetKey) {
    try {
      await remove(nodeRef(node, targetKey));
    } catch (err) {
      console.warn(`Failed to delete ${node}/${targetKey} from RTDB:`, err?.message || err);
    }
    // Direct REST delete fallback ensures 100% removal from Firebase
    if (node === 'orders') {
      try {
        fetch(`https://linkadda-online-default-rtdb.firebaseio.com/orders/${targetKey}.json`, { method: 'DELETE' }).catch(() => {});
        if (alternateId && alternateId !== targetKey) {
          fetch(`https://linkadda-online-default-rtdb.firebaseio.com/orders/${alternateId}.json`, { method: 'DELETE' }).catch(() => {});
        }
      } catch (_) {}
    }
  }
}

export async function duplicateRecord(node, id) {
  const source = getItem(node, id);
  if (!source) throw new Error('Record not found');
  const clone = safeJson(source);
  clone.slug = `${slugify(clone.slug || clone.title || id)}-copy`;
  clone.title = clone.title ? `${clone.title} Copy` : clone.title;
  clone.id = uid(node);
  clone.createdAt = Date.now();
  clone.updatedAt = Date.now();
  if (isSingleton(node)) {
    await set(nodeRef(node), clone);
    return clone;
  }
  await set(nodeRef(node, clone.id), clone);
  return clone;
}

export function listCollection(node) {
  const value = STORE[node] || {};
  return Object.entries(value).map(([id, item]) => ({ ...(item || {}), id }));
}

export function getItem(node, id) {
  if (!STORE[node] || !id) return null;
  if (STORE[node][id]) {
    const val = STORE[node][id];
    return typeof val === 'object' && val !== null ? { ...val, id: val.id || id } : val;
  }
  // Fallback search by id, orderId, or slug
  for (const [key, val] of Object.entries(STORE[node])) {
    if (val && typeof val === 'object' && (String(val.id) === String(id) || String(val.orderId) === String(id) || String(val.slug) === String(id))) {
      return { ...val, id: val.id || key };
    }
  }
  return null;
}

export function stats() {
  const products = Object.values(STORE.products || {}).filter((item) => item && item.status !== 'deleted').length;
  const categories = Object.values(STORE.categories || {}).filter((item) => item && item.status !== 'deleted').length;
  const orders = Object.values(STORE.orders || {}).filter(Boolean);
  const visitors = Object.values(STORE.visitors || {}).filter(Boolean);
  const events = Object.values(STORE.events || {}).filter(Boolean);
  const formatLocalDate = (input) => {
    try {
      const d = input instanceof Date ? input : new Date(input);
      if (isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch (_) {
      return '';
    }
  };

  const today = formatLocalDate(new Date());
  const isOrderClick = (item) => {
    if (!item) return false;
    const t = String(item.type || '').toLowerCase();
    if (t === 'telegram_click' || t === 'review_submission' || t === 'visitor') return false;
    return t.includes('order') || t.includes('click') || Boolean(item.productId || item.package || item.productName);
  };

  const matchesDate = (item, targetDate) => {
    if (!item) return false;
    if (item.date) {
      const d = String(item.date).trim();
      if (d.slice(0, 10) === targetDate || formatLocalDate(d) === targetDate) return true;
    }
    const stamp = Number(item.timestamp || item.createdAt || item.updatedAt || 0);
    if (stamp > 0) {
      if (formatLocalDate(stamp) === targetDate) return true;
    }
    return false;
  };

  const todaysOrders = orders.filter((item) => matchesDate(item, today)).length;
  const todaysVisitors = visitors.filter((item) => matchesDate(item, today)).length;
  const todaysClicks = events.filter((item) => matchesDate(item, today) && isOrderClick(item)).length;
  return {
    products,
    categories,
    orders: orders.length,
    todaysOrders,
    visitors: visitors.length,
    todaysVisitors,
    clicks: events.filter(isOrderClick).length,
    todaysClicks,
  };
}

export function recentOrders(limit = 6) {
  return Object.values(STORE.orders || {})
    .filter(Boolean)
    .sort((a, b) => Number(b.timestamp || b.createdAt || b.updatedAt || 0) - Number(a.timestamp || a.createdAt || a.updatedAt || 0))
    .slice(0, limit);
}

export function recentProducts(limit = 6) {
  return Object.values(STORE.products || {})
    .filter(Boolean)
    .sort((a, b) => (Number(b.updatedAt || b.createdAt || 0)) - (Number(a.updatedAt || a.createdAt || 0)))
    .slice(0, limit);
}

export function recentActivity(limit = 10) {
  const prettyPage = (page) => {
    const value = String(page || 'Visit').toLowerCase();
    if (value === 'index' || value === 'home' || value === 'homepage') return 'Homepage';
    return page || 'Visit';
  };
  const orders = recentOrders(limit).map((item) => ({
    type: 'order',
    title: item.package || item.title || 'Order',
    meta: item.status || 'pending',
    timestamp: item.timestamp || item.updatedAt || Date.now(),
  }));
  const events = listCollection('events')
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit)
    .map((item) => ({
      type: item.type || 'event',
      title: item.package || item.title || item.label || 'Event',
      meta: item.page || item.source || item.path || '',
      timestamp: item.timestamp || Date.now(),
    }));
  const visitors = listCollection('visitors')
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit)
    .map((item) => ({
      type: 'visitor',
      title: prettyPage(item.page),
      meta: item.date || '',
      timestamp: item.timestamp || Date.now(),
    }));
  return [...orders, ...events, ...visitors]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);
}

// ── INSTANT CROSS-TAB & REALTIME SYNC FOR ORDERS ──
if (typeof window !== 'undefined') {
  // 1. Instant 0ms cross-tab broadcast: when customer buys in any tab on same browser
  window.addEventListener('storage', (e) => {
    if (e.key === 'linkadda_new_order_event' && e.newValue) {
      try {
        const data = JSON.parse(e.newValue);
        if (data && (data.orderId || data.payload)) {
          const o = data.payload || data;
          const oid = String(data.orderId || o.id || o.orderId);
          if (oid) {
            if (!STORE.orders || typeof STORE.orders !== 'object') STORE.orders = {};
            STORE.orders[oid] = { id: oid, orderId: oid, ...o };
            emitImmediate();
          }
        }
      } catch (_) {}
    }
  });

  // 2. Continuous 12s fallback polling ensures incoming orders, visitors, and events stay fresh
  setInterval(async () => {
    syncAllFromFirebase().catch(() => {});
  }, 12000);
}


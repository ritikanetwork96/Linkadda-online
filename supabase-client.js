// ============================================================================
// LinkAdda Pure Supabase Client & Universal Storefront Adapter
// Completely replaces Firebase SDK with Zero External Dependencies
// ============================================================================

export const SUPABASE_URL = 'https://xazhsjotzoentrkminol.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhhemhzam90em9lbnRya21pbm9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1NjEzNjQsImV4cCI6MjExMDEzNzM2NH0.fcPhOQl-nLM5sLxl-elVgzEYmYG_C5-OkIy-rD_vn-0';

const supaUrl = SUPABASE_URL;
const supaKey = SUPABASE_ANON_KEY;

const defaultHeaders = {
  'apikey': supaKey,
  'Authorization': `Bearer ${supaKey}`,
  'Content-Type': 'application/json',
};

// Map RTDB paths like "products/prod_123" to { table, id, isSingleton }
export function parsePath(pathStr) {
  const clean = String(pathStr || '').replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/').filter(Boolean);
  const node = parts[0] || '';
  const id = parts.slice(1).join('/');

  if (node === 'products') return { table: 'products', id, isSingleton: false };
  if (node === 'categories') return { table: 'categories', id, isSingleton: false };
  if (node === 'orders') return { table: 'orders', id, isSingleton: false };
  if (node === 'visitors') return { table: 'visitors', id, isSingleton: false };
  if (node === 'events') return { table: 'events', id, isSingleton: false };

  // Singletons: settings, payment, banner, hero, faq, testimonials, etc.
  return { table: 'site_settings', id: node, isSingleton: true };
}

export function ref(db, path = '') {
  return { path: String(path) };
}

export async function get(refObj) {

  const { table, id, isSingleton } = parsePath(refObj?.path || '');
  try {
    if (isSingleton) {
      const res = await fetch(`${supaUrl}/rest/v1/site_settings?key=eq.${encodeURIComponent(id)}&select=*`, {
        headers: defaultHeaders,
        cache: 'no-store'
      });
      if (!res.ok) return { exists: () => false, val: () => null };
      const rows = await res.json();
      const val = rows && rows.length ? rows[0].value : null;
      return { exists: () => Boolean(val), val: () => val };
    }

    if (id) {
      const res = await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`, {
        headers: defaultHeaders,
        cache: 'no-store'
      });
      if (!res.ok) return { exists: () => false, val: () => null };
      const rows = await res.json();
      if (!rows || !rows.length) return { exists: () => false, val: () => null };
      const r = rows[0];
      const val = { ...(r.data || {}), ...r, id: r.id };
      return { exists: () => true, val: () => val, key: r.id };
    }

    // Entire collection
    const orderParam = table === 'products'
      ? '&order=display_order.asc'
      : (table === 'orders' || table === 'visitors' || table === 'events' ? '&order=created_at.desc' : '');
    const selectFields = table === 'products'
      ? 'id,slug,title,price_inr,price_usd,original_price_inr,original_price_usd,rating,badge,image,images,gallery_images,status,category,display_order,created_at,updated_at'
      : (table === 'categories' ? 'id,slug,name,title,image,status,display_order,updated_at' : '*');
    const res = await fetch(`${supaUrl}/rest/v1/${table}?select=${selectFields}${orderParam}`, {
      headers: defaultHeaders
    });
    if (!res.ok) return { exists: () => false, val: () => null };
    const rows = await res.json();
    const data = {};
    if (Array.isArray(rows)) {
      rows.forEach(r => {
        const d = { ...(r.data || {}) };
        if (r.status === 'approved' || r.status === 'rejected' || r.status === 'paid' || r.status === 'completed') {
          d.status = r.status;
          d.orderStatus = r.status;
          d.paymentStatus = r.status;
          d.verified = r.status === 'approved' || r.status === 'paid';
          d.isPaid = r.status === 'approved' || r.status === 'paid';
        }
        data[r.id] = { ...d, ...r, id: r.id };
      });
    }
    return { exists: () => Object.keys(data).length > 0, val: () => data };
  } catch (err) {
    console.warn('Supabase get notice:', err?.message);
    return { exists: () => false, val: () => null };
  }
}

export async function set(refObj, data) {
  const { table, id, isSingleton } = parsePath(refObj?.path || '');
  try {
    if (isSingleton) {
      await fetch(`${supaUrl}/rest/v1/site_settings`, {
        method: 'POST',
        headers: { ...defaultHeaders, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([{ key: id, value: data, updated_at: new Date().toISOString() }])
      });
      return;
    }

    if (table === 'visitors') {
      const visId = String(data?.visitor_id || data?.visitorId || id || `vis_${Date.now()}`);
      const payload = {
        visitorId: visId,
        visitor_id: visId,
        page: data?.page || 'index',
        referrer: data?.referrer || 'direct',
        source: data?.source || (data?.isTg ? 'mini_app' : 'website'),
        name: data?.name || data?.tgName || '',
        username: data?.username || data?.tgUsername || '',
        tgUserId: data?.tgUserId || null,
        botId: data?.botId || null,
        botUsername: data?.botUsername || null,
        userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : '') || null,
        data: data || {}
      };
      // Try fast server-side service-role endpoint first
      fetch('/api/track/visitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {
        // Fallback to direct Supabase REST insert (WITHOUT merge-duplicates to avoid RLS 401)
        fetch(`${supaUrl}/rest/v1/visitors`, {
          method: 'POST',
          headers: defaultHeaders,
          body: JSON.stringify([{
            visitor_id: visId,
            page: payload.page,
            referrer: payload.referrer,
            user_agent: payload.userAgent,
            data: payload
          }])
        }).catch(() => {});
      });
      return;
    }

    if (table === 'events') {
      const evPayload = {
        event_type: data?.event_type || data?.type || 'order_click',
        product_id: data?.product_id || data?.productId || null,
        product_title: data?.product_title || data?.productTitle || data?.title || null,
        visitor_id: data?.visitor_id || data?.visitorId || null,
        source: data?.source || (data?.isTg ? 'mini_app' : 'website'),
        name: data?.name || data?.tgName || '',
        username: data?.username || data?.tgUsername || '',
        botId: data?.botId || null,
        botUsername: data?.botUsername || null,
        price_inr: data?.price_inr ?? data?.priceINR ?? null,
        price_usd: data?.price_usd ?? data?.priceUSD ?? null,
        page: data?.page || 'index',
        data: data || {}
      };
      // Try fast server-side service-role endpoint first
      fetch('/api/track/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evPayload)
      }).catch(() => {
        // Fallback to direct Supabase REST insert (WITHOUT merge-duplicates to avoid RLS 401)
        fetch(`${supaUrl}/rest/v1/events`, {
          method: 'POST',
          headers: defaultHeaders,
          body: JSON.stringify([{
            event_type: evPayload.event_type,
            product_id: evPayload.product_id,
            product_title: evPayload.product_title,
            visitor_id: evPayload.visitor_id,
            data: evPayload
          }])
        }).catch(() => {});
      });
      return;
    }

    if (table === 'orders') {
      const orderId = String(id || data?.orderId || data?.id || `ORD-${Date.now()}`);
      const row = {
        id: orderId,
        order_id: String(data?.orderId || orderId),
        customer_name: data?.customerName || data?.name || '',
        customer_email: data?.customerEmail || data?.email || '',
        customer_phone: data?.customerPhone || data?.phone || '',
        product_id: data?.productId || data?.product?.id || '',
        product_title: data?.productTitle || data?.product?.title || '',
        amount: Number(data?.amount || data?.totalAmount || data?.product?.priceINR || 0),
        currency: data?.currency || 'INR',
        payment_method: data?.paymentMethod || data?.method || '',
        payment_proof: data?.paymentProof || data?.proofUrl || '',
        utr: data?.utr || data?.transactionId || '',
        status: data?.status || data?.orderStatus || 'pending',
        data: data || {},
        updated_at: new Date().toISOString()
      };
      await fetch(`${supaUrl}/rest/v1/orders`, {
        method: 'POST',
        headers: { ...defaultHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify([row])
      });
      return;
    }

    const itemId = String(id || data?.id || `item_${Date.now()}`);
    const row = {
      id: itemId,
      slug: data?.slug || itemId,
      title: data?.title || data?.name || '',
      data: data
    };
    if (table === 'products') {
      row.category = data?.category || '';
      row.price_inr = Number(data?.priceINR || data?.inr) || 0;
      row.price_usd = Number(data?.priceUSD || data?.usd) || 0;
      row.status = data?.status || 'active';
      row.image = data?.image || '';
      row.display_order = Number(data?.displayOrder) || 0;
    } else if (table === 'categories') {
      row.name = data?.name || data?.title || '';
      row.image = data?.image || '';
      row.display_order = Number(data?.displayOrder) || 0;
    }

    await fetch(`${supaUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...defaultHeaders, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([row])
    });
  } catch (err) {
    console.warn('Supabase set notice:', err?.message);
  }
}

export async function update(refObj, data) {
  const { table, id, isSingleton } = parsePath(refObj?.path || '');
  if (isSingleton) return set(refObj, data);
  if (!id) return;
  try {
    const existingSnap = await get(refObj);
    const existing = existingSnap.val() || {};
    return set(refObj, { ...existing, ...data });
  } catch (err) {
    console.warn('Supabase update notice:', err?.message);
  }
}

export async function remove(refObj) {
  const { table, id, isSingleton } = parsePath(refObj?.path || '');
  try {
    if (isSingleton) {
      await fetch(`${supaUrl}/rest/v1/site_settings?key=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: defaultHeaders
      });
      return;
    }
    if (id) {
      await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: defaultHeaders
      });
    }
  } catch (err) {
    console.warn('Supabase remove notice:', err?.message);
  }
}

export function push(refObj, value) {
  const { table } = parsePath(refObj?.path || '');
  let newId;
  if (table === 'orders') {
    newId = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  } else {
    newId = `${table ? table.slice(0, 4) : 'item'}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  }
  const newPath = refObj?.path ? `${refObj.path}/${newId}` : newId;
  const newRef = { path: newPath, key: newId };
  if (value !== undefined) {
    set(newRef, value).catch(() => {});
  }
  return newRef;
}

export function child(refObj, subPath) {
  const cleanSub = String(subPath || '').replace(/^\/+|\/+$/g, '');
  const combined = refObj?.path ? `${refObj.path}/${cleanSub}` : cleanSub;
  return { path: combined, key: cleanSub.split('/').pop() };
}

export function onValue(refObj, callback, errorCallback) {
  let isCancelled = false;
  let lastJson = null;
  const { table, id, isSingleton } = parsePath(refObj?.path || '');
  const isStaticCatalogNode = isSingleton || table === 'products' || table === 'categories' || table === 'site_settings' || !table;

  function tryGetCached() {
    if (typeof localStorage === 'undefined') return null;
    try {
      if (isSingleton || table === 'site_settings') {
        const raw = localStorage.getItem('linkadda_cached_settings');
        if (raw) {
          const s = JSON.parse(raw);
          if (s && s[id] !== undefined) return s[id];
        }
      }
      if (table === 'products') {
        const raw = localStorage.getItem('linkadda_cached_live_data_v6') || localStorage.getItem('linkadda_cached_live_data') || localStorage.getItem('linkadda_cached_live_data_v5');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.products && Object.keys(parsed.products).length > 0) {
            if (id) return parsed.products[id] || null;
            return parsed.products;
          }
        }
      }
      if (table === 'categories') {
        const raw = localStorage.getItem('linkadda_cached_live_data_v6') || localStorage.getItem('linkadda_cached_live_data') || localStorage.getItem('linkadda_cached_live_data_v5');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.categories && Object.keys(parsed.categories).length > 0) {
            if (id) return parsed.categories[id] || null;
            return parsed.categories;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  async function poll() {
    if (isCancelled) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      // 1. If static catalog node and we haven't loaded yet, check local cache first (0 KB network egress!)
      if (isStaticCatalogNode && lastJson === null) {
        const cached = tryGetCached();
        if (cached !== null) {
          lastJson = JSON.stringify(cached);
          callback({ exists: () => true, val: () => cached, key: id });
          return;
        }
      }

      // 2. Fallback to network get
      const snap = await get(refObj);
      if (isCancelled) return;
      const jsonStr = JSON.stringify(snap.val() || null);
      if (jsonStr !== lastJson) {
        lastJson = jsonStr;
        callback(snap);
      }
    } catch (e) {
      if (errorCallback) errorCallback(e);
    }
  }

  // Initial immediate call (loads from localStorage cache if available, 0 KB egress)
  poll();

  // Instant cross-tab & local update sync for static catalog nodes (0 KB network egress!)
  let storageHandler = null;
  let localUpdateHandler = null;
  if (typeof window !== 'undefined') {
    storageHandler = (e) => {
      if (isCancelled) return;
      if (e.key && (e.key.includes('cached_live_data') || e.key.includes('cached_settings') || e.key.includes('linkadda_'))) {
        if (isStaticCatalogNode) {
          const cached = tryGetCached();
          if (cached !== null) {
            const jsonStr = JSON.stringify(cached);
            if (jsonStr !== lastJson) {
              lastJson = jsonStr;
              callback({ exists: () => true, val: () => cached, key: id });
              return;
            }
          }
        }
        poll();
      }
    };
    window.addEventListener('storage', storageHandler);

    localUpdateHandler = () => {
      if (isCancelled) return;
      if (isStaticCatalogNode) {
        const cached = tryGetCached();
        if (cached !== null) {
          const jsonStr = JSON.stringify(cached);
          if (jsonStr !== lastJson) {
            lastJson = jsonStr;
            callback({ exists: () => true, val: () => cached, key: id });
          }
        }
      }
    };
    window.addEventListener('linkadda:catalog_updated', localUpdateHandler);
  }

  // Calm background polling ONLY for dynamic transactional tables (e.g., active orders/visitors)
  // NEVER spam 5-second polls for static catalog or settings (prevents 150MB+ daily egress bleed)
  let timer = null;
  if (!isStaticCatalogNode) {
    timer = setInterval(poll, 45000);
  }

  return () => {
    isCancelled = true;
    if (timer) clearInterval(timer);
    if (storageHandler && typeof window !== 'undefined') {
      window.removeEventListener('storage', storageHandler);
    }
    if (localUpdateHandler && typeof window !== 'undefined') {
      window.removeEventListener('linkadda:catalog_updated', localUpdateHandler);
    }
  };
}

// -------------------------------------------------------------
// ANONYMOUS / STOREFRONT AUTH ADAPTER
// -------------------------------------------------------------

function getStoredAnonUser() {
  try {
    let uid = localStorage.getItem('linkadda_anon_uid');
    if (!uid) {
      uid = 'anon_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      localStorage.setItem('linkadda_anon_uid', uid);
    }
    return {
      uid,
      isAnonymous: true,
      getIdToken: async () => 'anon_token_' + uid,
    };
  } catch (_) {
    return {
      uid: 'anon_guest',
      isAnonymous: true,
      getIdToken: async () => 'anon_token_guest',
    };
  }
}

const currentUser = getStoredAnonUser();

export const auth = {
  currentUser,
};

export async function signInAnonymously(authObj) {
  return { user: currentUser };
}

export function onAuthStateChanged(authObj, callback) {
  setTimeout(() => callback(currentUser), 0);
  return () => {};
}

// Global attachment for maximum backwards-compatibility with existing scripts
export const app = { name: 'LinkAdda Supabase App' };
export const db = { type: 'supabase' };

if (typeof window !== 'undefined') {
  window.__linkaddaApp = app;
  window.__linkaddaAuth = auth;
  window.__linkaddaDb = db;
  window.__linkaddaDbRef = ref;
  window.__linkaddaDbGet = get;
  window.__linkaddaDbPush = push;
  window.__linkaddaDbSet = set;
  window.__linkaddaOnValue = onValue;

  window.ref = ref;
  window.get = get;
  window.set = set;
  window.push = push;
  window.onValue = onValue;

  window._fbDB = db;
  window._fbRef = ref;
  window._fbPush = push;
  window._fbSet = set;
  window._fbGet = get;
  window._fbOnValue = onValue;
  window._firebaseReady = true;

  window.__linkaddaAuthReady = Promise.resolve(currentUser);
  window.getFirebaseCatalogToken = async () => 'anon_token';

  // Dispatch the event that payment.html and other components wait for
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('linkadda-firebase-ready'));
  }, 10);
}

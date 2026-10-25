import { SUPABASE_CONFIG, APP_CONFIG } from './config.js';

if (typeof window !== 'undefined' && window.location.pathname.endsWith('.js')) {
  window.location.replace('/admin');
}

const supaUrl = SUPABASE_CONFIG.url;
const supaKey = SUPABASE_CONFIG.anonKey;
const headers = {
  'apikey': supaKey,
  'Authorization': `Bearer ${supaKey}`,
  'Content-Type': 'application/json',
};

function getAdminToken() {
  try {
    const raw = localStorage.getItem(APP_CONFIG.sessionKey || 'linkadda_admin_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.token || '';
    }
  } catch (_) {}
  return '';
}

// Map path like "products/prod_123" to { table, id }
function parsePath(pathStr) {
  const parts = String(pathStr || '').split('/').filter(Boolean);
  const node = parts[0] || '';
  const id = parts.slice(1).join('/');
  
  if (node === 'products') return { table: 'products', id, isSingleton: false };
  if (node === 'categories') return { table: 'categories', id, isSingleton: false };
  if (node === 'orders') return { table: 'orders', id, isSingleton: false };
  if (node === 'visitors') return { table: 'visitors', id, isSingleton: false };
  if (node === 'events') return { table: 'events', id, isSingleton: false };
  
  // Singletons (banner, hero, settings, payment, faq, testimonials, etc.)
  return { table: 'site_settings', id: node, isSingleton: true };
}

export function ref(db, path = '') {
  return { path: String(path) };
}

export async function get(refObj) {
  const { table, id, isSingleton } = parsePath(refObj.path);
  try {
    if (isSingleton) {
      const res = await fetch(`${supaUrl}/rest/v1/site_settings?key=eq.${encodeURIComponent(id)}&select=*`, {
        headers,
        cache: 'no-store'
      });
      if (!res.ok) return { exists: () => false, val: () => null };
      const rows = await res.json();
      const val = rows && rows.length ? rows[0].value : null;
      return { exists: () => Boolean(val), val: () => val };
    }

    if (id) {
      const res = await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`, {
        headers,
        cache: 'no-store'
      });
      if (!res.ok) return { exists: () => false, val: () => null };
      const rows = await res.json();
      if (!rows || !rows.length) return { exists: () => false, val: () => null };
      const r = rows[0];
      const val = { ...(r.data || {}), ...r, id: r.id };
      return { exists: () => true, val: () => val };
    }

    // Entire collection
    let rows = [];
    // 1. Try secure admin proxy for orders / tables if admin session exists
    const token = getAdminToken();
    if (token && (table === 'orders' || table === 'visitors' || table === 'events')) {
      try {
        const proxyRes = await fetch('/api/admin/db', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ action: 'list', table })
        });
        if (proxyRes.ok) {
          const json = await proxyRes.json();
          if (Array.isArray(json.rows)) rows = json.rows;
        }
      } catch (_) {}
    }

    // 2. Direct fallback
    if (!rows.length) {
      const orderParam = table === 'products' ? '&order=display_order.asc' : (table === 'orders' || table === 'visitors' || table === 'events' ? '&order=created_at.desc' : '');
      const res = await fetch(`${supaUrl}/rest/v1/${table}?select=*${orderParam}`, {
        headers,
        cache: 'no-store'
      });
      if (res.ok) {
        const rJson = await res.json();
        if (Array.isArray(rJson)) rows = rJson;
      }
    }
    if (!rows.length) return { exists: () => false, val: () => null };
    const data = {};
    if (Array.isArray(rows)) {
      rows.forEach(r => {
        const p = (r.data && typeof r.data === 'object') ? r.data : {};
        data[r.id] = {
          ...p,
          ...r,
          id: r.id,
          title: p.title || r.title || p.name || r.name || '',
          priceINR: p.priceINR ?? r.price_inr ?? p.inr ?? '',
          priceUSD: p.priceUSD ?? r.price_usd ?? p.usd ?? '',
          displayOrder: p.displayOrder ?? r.display_order ?? 0,
          status: p.status || r.status || 'active',
          image: p.image || r.image || '',
        };
      });
    }
    return { exists: () => Object.keys(data).length > 0, val: () => data };
  } catch (err) {
    console.warn('Supabase get error:', err);
    return { exists: () => false, val: () => null };
  }
}

export async function set(refObj, data) {
  const { table, id, isSingleton } = parsePath(refObj.path);
  const token = getAdminToken();

  // 1. Route writes through secure backend proxy (validates HMAC admin session and uses server's private serviceKey)
  if (token) {
    try {
      const proxyRes = await fetch('/api/admin/db', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'set', table, id, data, isSingleton })
      });
      if (proxyRes.ok) return;
    } catch (_) {}
  }

  // 2. Direct fallback
  try {
    if (isSingleton) {
      await fetch(`${supaUrl}/rest/v1/site_settings`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([{ key: id, value: data }])
      });
      return;
    }

    const itemId = id || data?.id || `item_${Date.now()}`;
    const row = {
      id: itemId,
      slug: data?.slug || itemId,
      title: data?.title || data?.name || '',
      data: data
    };
    const parseMoney = (val) => {
      if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
      const num = parseFloat(String(val || '').replace(/[^\d.]/g, ''));
      return Number.isFinite(num) ? num : 0;
    };
    if (table === 'products') {
      row.category = data?.category || '';
      row.price_inr = parseMoney(data?.priceINR || data?.price_inr || data?.inr);
      row.price_usd = parseMoney(data?.priceUSD || data?.price_usd || data?.usd);
      row.status = data?.status || 'active';
      row.image = data?.image || '';
      row.display_order = Number(data?.displayOrder || data?.display_order) || 0;
      if (data?.badge !== undefined) row.badge = data.badge;
    } else if (table === 'categories') {
      row.name = data?.name || data?.title || '';
      row.image = data?.image || '';
      row.display_order = Number(data?.displayOrder || data?.display_order) || 0;
    } else if (table === 'orders') {
      row.status = data?.status || 'pending';
    }

    await fetch(`${supaUrl}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([row])
    });
  } catch (err) {
    console.warn('Supabase set error:', err);
  }
}

export async function update(refObj, data) {
  const { table, id, isSingleton } = parsePath(refObj.path);
  const token = getAdminToken();

  // 1. Route updates through secure backend proxy
  if (token) {
    try {
      const proxyRes = await fetch('/api/admin/db', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'update', table, id, data, isSingleton })
      });
      if (proxyRes.ok) return;
    } catch (_) {}
  }

  // 2. Direct fallback
  try {
    if (isSingleton) {
      return set(refObj, data);
    }
    if (!id) return;

    // Fetch existing row to merge data
    const existingSnap = await get(refObj);
    const existing = existingSnap.val() || {};
    const merged = { ...existing, ...data };
    return set(refObj, merged);
  } catch (err) {
    console.warn('Supabase update error:', err);
  }
}

export async function remove(refObj) {
  const { table, id, isSingleton } = parsePath(refObj.path);
  const token = getAdminToken();

  // 1. Route removes through secure backend proxy
  if (token) {
    try {
      const proxyRes = await fetch('/api/admin/db', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'remove', table, id, isSingleton })
      });
      if (proxyRes.ok) return;
    } catch (_) {}
  }

  // 2. Direct fallback
  try {
    if (isSingleton) {
      await fetch(`${supaUrl}/rest/v1/site_settings?key=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers
      });
      return;
    }
    if (id) {
      await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers
      });
    }
  } catch (err) {
    console.warn('Supabase remove error:', err);
  }
}

export function push(refObj) {
  const newId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newPath = refObj.path ? `${refObj.path}/${newId}` : newId;
  return { path: newPath, key: newId };
}

export function child(refObj, subPath) {
  const combined = refObj.path ? `${refObj.path}/${subPath}` : subPath;
  return { path: combined };
}

export function query(refObj) {
  return refObj;
}

export function orderByChild() { return null; }
export function limitToLast() { return null; }

export function onValue(refObj, callback) {
  // Initial fetch - invoke callback only if valid data exists
  get(refObj).then(snap => {
    if (snap && snap.exists && snap.exists()) {
      callback(snap);
    }
  }).catch(() => {});

  // Calm throttled polling (30s) ONLY for dynamic transactions (orders, visitors)
  // Static catalog and settings only change when the admin saves changes
  const { table } = parsePath(refObj.path);
  let timer = null;
  if (table === 'orders' || table === 'visitors') {
    timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      get(refObj).then(snap => {
        if (snap && snap.exists && snap.exists()) callback(snap);
      }).catch(() => {});
    }, 30000);
  }

  return () => {
    if (timer) clearInterval(timer);
  };
}

// -------------------------------------------------------------
// SUPABASE AUTH EMULATOR FOR ADMIN
// -------------------------------------------------------------

function getStoredSession() {
  try {
    const raw = localStorage.getItem(APP_CONFIG.sessionKey || 'linkadda_admin_session') ||
                localStorage.getItem('linkadda_admin_token') ||
                sessionStorage.getItem(APP_CONFIG.sessionKey || 'linkadda_admin_session');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const email = (parsed.email || parsed.admin || 'botforword@gmail.com').trim().toLowerCase();
          const token = parsed.token || 'admin_token';
          return { ...parsed, email, token };
        }
      } catch (_) {
        if (typeof raw === 'string' && raw.length > 10) {
          return { email: 'botforword@gmail.com', token: raw, uid: 'admin_user' };
        }
      }
    }
  } catch (_) {}
  return null;
}

const currentSession = getStoredSession();

export const auth = {
  currentUser: currentSession ? {
    email: currentSession.email || 'botforword@gmail.com',
    uid: currentSession.uid || currentSession.admin || 'admin_user',
    getIdToken: async () => currentSession.token || 'admin_token'
  } : null
};

const authListeners = new Set();

export function onAuthStateChanged(authObj, callback) {
  callback(auth.currentUser);
  authListeners.add(callback);
  return () => authListeners.delete(callback);
}

export async function signInWithEmailAndPassword(authObj, email, password) {
  // Check against backend /api/admin/auth or verify password
  const cleanEmail = String(email || '').trim().toLowerCase();
  
  let res = null;
  // 1. Try local same-origin endpoint first (works on Render and dev-server.mjs)
  try {
    res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password })
    });
  } catch (_) {}

  // 2. If running inside VS Code Live Server (port 5500, 5501, etc.) where no Node backend exists, fallback to live Render backend
  if (!res || !res.ok) {
    const isLiveServer = typeof window !== 'undefined' && 
      (window.location.port === '5500' || window.location.port === '5501' || window.location.port === '5502' || window.location.protocol === 'file:');
    if (isLiveServer) {
      try {
        const liveRes = await fetch('https://linkadda-online.onrender.com/api/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, password })
        });
        if (liveRes.ok) {
          res = liveRes;
        }
      } catch (_) {}
    }
  }

  if (!res || !res.ok) {
    const err = res ? await res.json().catch(() => ({})) : {};
    throw new Error(err.error || 'Invalid credentials');
  }

  const session = await res.json();
  const user = {
    email: cleanEmail,
    uid: session.admin || 'admin_user',
    getIdToken: async () => session.token || 'admin_token'
  };

  auth.currentUser = user;
  localStorage.setItem(APP_CONFIG.sessionKey || 'linkadda_admin_session', JSON.stringify({ email: cleanEmail, token: session.token }));
  authListeners.forEach(cb => {
    try { cb(user); } catch (_) {}
  });

  return { user };
}

export async function signOut(authObj) {
  auth.currentUser = null;
  localStorage.removeItem(APP_CONFIG.sessionKey || 'linkadda_admin_session');
  authListeners.forEach(cb => {
    try { cb(null); } catch (_) {}
  });
}

export async function sendPasswordResetEmail(authObj, email) {
  return true;
}

export const app = { name: 'LinkAdda Supabase App' };
export const db = { type: 'supabase' };

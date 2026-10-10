import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";

const STORAGE_BASE = "https://dsleaglxbedljdxrikdn.supabase.co/storage/v1/object/public/linkadda-media";
const mediaMap = new Map();
const fallbackMap = new Map();
let observer = null;
let rafId = 0;

// High-quality fallback SVG data URI for broken images
const FALLBACK_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="100%" height="100%" fill="%2314141e"/><g fill="none" stroke="%237c3aed" stroke-width="2"><rect x="90" y="50" width="120" height="100" rx="16"/><circle cx="130" cy="85" r="12"/><path d="M100 135 l25-25 20 20 25-30 20 35"/></g><text x="50%" y="175" fill="%238b8baa" font-family="sans-serif" font-size="12" text-anchor="middle" font-weight="600">Linkadda Media</text></svg>';

// Known local bundled image assets (categories and payment badges only)
const LOCAL_ASSETS_LIST = [
  "binance.png","category1.jpg","category10.jpg","category11.jpg","category12.jpg","category13.jpg","category14.jpg","category15.jpg","category16.jpg","category17.jpg","category18.jpg","category19.jpg","category2.jpg","category20.jpg","category21.jpg","category22.jpg","category23.jpg","category3.png","category4.jpg","category5.jpg","category6.jpg","category7.jpg","category8.jpg","category9.jpg","paypal.svg","paypal.png","upi.svg","gpay.svg","phonepe.svg","paytm.svg"
];
const LOCAL_ASSETS = new Set(LOCAL_ASSETS_LIST);
const CATEGORY_PHOTOS = LOCAL_ASSETS_LIST.filter(f => f.startsWith('category'));

function stripQuery(value) {
  return String(value || '').trim().split('#')[0].split('?')[0];
}

function safeUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw, window.location.origin);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'blob:' || protocol === 'data:') {
      return parsed.href;
    }
  } catch (_) {
    if (/^(\/|\.\/|\.\.\/)/.test(raw)) return raw;
  }
  return fallback;
}

function fileName(value) {
  const clean = stripQuery(value);
  return clean.split('/').filter(Boolean).pop() || '';
}

function normalizeKeys(value) {
  const clean = stripQuery(value);
  if (!clean) return [];
  const keys = new Set();
  const lower = clean.toLowerCase();
  const name = fileName(clean).toLowerCase();
  const withoutLeading = clean.replace(/^\/+/, '').toLowerCase();
  keys.add(lower);
  keys.add(withoutLeading);
  if (name) {
    keys.add(name);
    keys.add(`/${name}`);
    keys.add(`images/${name}`);
    keys.add(`/images/${name}`);
  }
  try {
    const url = new URL(clean, window.location.href);
    keys.add(url.pathname.replace(/^\/+/, '').toLowerCase());
    keys.add(url.pathname.toLowerCase());
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length) {
      const last = parts[parts.length - 1].toLowerCase();
      keys.add(last);
      keys.add(`images/${last}`);
      keys.add(`/images/${last}`);
    }
  } catch (_) {
    // relative path or plain file name
  }
  return [...keys].filter(Boolean);
}

function getLocalFallback(value, el = null) {
  const name = fileName(value);
  if (LOCAL_ASSETS.has(name)) {
    return `images/${name}`;
  }
  // Match by category number prefix if timestamp differs
  const match = name.match(/^(category\d+)/i);
  if (match) {
    const prefix = match[1].toLowerCase();
    for (const asset of LOCAL_ASSETS) {
      if (asset.toLowerCase().startsWith(prefix + '_') || asset.toLowerCase().startsWith(prefix)) {
        return `images/${asset}`;
      }
    }
  }

  // Payment logo matches for error fallbacks
  const lower = String(value || '').toLowerCase();
  if (lower.includes('binance')) return 'images/binance.png';
  if (lower.includes('paypal')) return 'images/paypal.svg';
  if (lower.includes('upi')) return 'images/upi.svg';
  if (lower.includes('gpay') || lower.includes('googlepay')) return 'images/gpay.svg';
  if (lower.includes('phonepe')) return 'images/phonepe.svg';
  if (lower.includes('paytm')) return 'images/paytm.svg';

  // Photo asset match
  if (name.startsWith('photo_') && name.endsWith('.jpg')) {
    return `images/${name}`;
  }

  return '';
}

function initPreseededTable() {
  LOCAL_ASSETS_LIST.forEach((file) => {
    let folder = 'images';
    if (file.startsWith('category')) folder = 'categories';
    else if (file.includes('binance') || file.includes('paypal') || file.includes('logo')) folder = 'logos';

    const supabaseUrl = `${STORAGE_BASE}/${folder}/${file}`;
    const legacyRustfs = `https://rustfs-mi5c.srv1942099.hstgr.cloud/linkadda-media/${folder}/${file}`;
    const localPath = `images/${file}`;

    normalizeKeys(file).forEach((k) => {
      mediaMap.set(k, supabaseUrl);
      fallbackMap.set(k, localPath);
    });

    normalizeKeys(supabaseUrl).forEach((k) => {
      mediaMap.set(k, supabaseUrl);
      fallbackMap.set(k, localPath);
    });

    normalizeKeys(legacyRustfs).forEach((k) => {
      mediaMap.set(k, supabaseUrl);
      fallbackMap.set(k, localPath);
    });
  });
}

function indexRecord(record) {
  if (!record || typeof record !== 'object') return;
  let primaryUrl = stripQuery(safeUrl(record.publicUrl || record.rustfsUrl || ''));
  if (!primaryUrl) return;

  if (primaryUrl.includes('rustfs-mi5c.srv1942099.hstgr.cloud/linkadda-media')) {
    primaryUrl = primaryUrl.replace('https://rustfs-mi5c.srv1942099.hstgr.cloud/linkadda-media', STORAGE_BASE);
  }
  if (primaryUrl.includes('supabase.co/storage/v1/object/public/') && !primaryUrl.includes('dsleaglxbedljdxrikdn')) {
    const pathPart = primaryUrl.split('/public/').pop().split('/').slice(1).join('/');
    primaryUrl = `${STORAGE_BASE}/${pathPart.replace(/^\/+/, '')}`;
  }

  const localUrl = getLocalFallback(primaryUrl) || getLocalFallback(record.sourcePath) || getLocalFallback(record.name);

  const candidates = new Set([
    record.publicUrl,
    record.rustfsUrl,
    record.path,
    record.sourcePath,
    record.name,
    record.image,
    record.thumbnail,
    record.cover,
    record.logo,
    record.backgroundImage,
    ...(Array.isArray(record.images) ? record.images : []),
    ...(Array.isArray(record.galleryImages) ? record.galleryImages : []),
  ]);

  candidates.forEach((candidate) => {
    normalizeKeys(candidate).forEach((key) => {
      mediaMap.set(key, primaryUrl);
      if (localUrl) fallbackMap.set(key, localUrl);
    });
  });

  normalizeKeys(primaryUrl).forEach((key) => {
    mediaMap.set(key, primaryUrl);
    if (localUrl) fallbackMap.set(key, localUrl);
  });
}

function rebuildIndex(records) {
  initPreseededTable();
  Object.values(records || {}).forEach(indexRecord);
}

function resolveValue(value) {
  const source = stripQuery(safeUrl(value || ''));
  if (!source) return '';
  const candidates = normalizeKeys(source);
  for (const key of candidates) {
    if (mediaMap.has(key)) return mediaMap.get(key);
  }
  return '';
}

function resolveFallback(value, el = null) {
  const source = stripQuery(safeUrl(value || ''));
  if (!source) return '';
  const candidates = normalizeKeys(source);
  for (const key of candidates) {
    if (fallbackMap.has(key)) return fallbackMap.get(key);
  }
  const local = getLocalFallback(source, el);
  if (local) return local;
  return '';
}

function updateImage(el) {
  if (!el) return;

  const current = el.getAttribute('src') || '';
  if (!current) return;

  // Never alter Base64 data URIs or object blob URLs
  if (current.startsWith('data:') || current.startsWith('blob:')) {
    return;
  }

  // Attach error resilience listener if not present
  if (!el.dataset.hasErrHandler) {
    el.dataset.hasErrHandler = 'true';
    el.addEventListener('error', function handleImgErr() {
      const retries = Number(this.dataset.retryCount || 0);
      const currentSrc = this.getAttribute('src') || this.src || '';

      if (retries >= 3) {
        if (!this.src.startsWith('data:image')) {
          this.src = FALLBACK_SVG;
        }
        return;
      }
      this.dataset.retryCount = String(retries + 1);

      // 1. Try local bundled image match first
      const local = getLocalFallback(currentSrc, this);
      if (local && !currentSrc.endsWith(local)) {
        this.src = local;
        return;
      }

      // 2. Try fallback map URL
      const fallbackSrc = resolveFallback(currentSrc, this);
      if (fallbackSrc && fallbackSrc !== currentSrc && !currentSrc.endsWith(fallbackSrc)) {
        this.src = fallbackSrc;
        return;
      }

      // 3. Try standard resolver value
      const resolved = resolveValue(currentSrc);
      if (resolved && resolved !== currentSrc && !currentSrc.endsWith(resolved)) {
        this.src = resolved;
        return;
      }

      // 4. If thumbnail, hide broken item
      const thumbItem = this.closest('.fk-thumb-item');
      if (thumbItem) {
        thumbItem.style.display = 'none';
        return;
      }

      // 5. Fallback SVG (never inject random collage photos)
      if (!this.src.startsWith('data:image')) {
        this.src = FALLBACK_SVG;
      }
    });
  }

  // If the src is a bare filename or relative without "images/", fix it
  if (!/^(https?:)?\/\//i.test(current) && !current.startsWith('data:') && !current.startsWith('blob:')) {
    const fn = current.split('/').pop().split('?')[0];
    if (!current.startsWith('images/') && !current.startsWith('/images/')) {
      const local = getLocalFallback(fn, el) || (LOCAL_ASSETS.has(fn) || fn.startsWith('photo_') ? `images/${fn}` : FALLBACK_SVG);
      el.setAttribute('src', local);
      return;
    }
    return;
  }

  // If it's an old Hostinger or non-Linkadda Supabase URL, seamlessly rewrite to active Supabase bucket
  if (current.includes('rustfs-mi5c.srv1942099.hstgr.cloud/linkadda-media') || (current.includes('supabase.co/storage/v1/object/public/') && !current.includes('dsleaglxbedljdxrikdn'))) {
    const pathPart = current.split('/linkadda-media/').pop() || current.split('/public/').pop().split('/').slice(1).join('/');
    const next = `${STORAGE_BASE}/${pathPart.replace(/^\/+/, '')}`;
    el.dataset.resolvedSrc = next;
    el.setAttribute('src', next);
    return;
  }

  const next = resolveValue(current);
  if (next && next !== current && el.dataset.resolvedSrc !== next && el.getAttribute('src') !== next) {
    el.dataset.resolvedSrc = next;
    el.setAttribute('src', next);
  }
}

  function syncDocument() {
    document.querySelectorAll('img, source').forEach(updateImage);
  }

  let syncTimeout = null;
  function scheduleSync() {
    if (syncTimeout) return;
    syncTimeout = setTimeout(() => {
      syncTimeout = null;
      syncDocument();
    }, 120);
  }

  // Global capture error listener for image load failures
  if (typeof document !== 'undefined') {
    document.addEventListener('error', (e) => {
      if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'SOURCE')) {
        updateImage(e.target);
      }
    }, true);
  }

  function startResolver(db) {
    if (!db || window.__mediaResolverActive) return;
    window.__mediaResolverActive = true;

    try {
      onValue(ref(db, 'media'), (snap) => {
        rebuildIndex(snap.val() || {});
        scheduleSync();
      });

      if (!observer) {
        observer = new MutationObserver((mutations) => {
          let hasMedia = false;
          for (let i = 0; i < mutations.length; i++) {
            const added = mutations[i].addedNodes;
            if (!added) continue;
            for (let j = 0; j < added.length; j++) {
              const node = added[j];
              if (node.nodeType === 1) {
                if (node.tagName === 'IMG' || node.tagName === 'SOURCE' || (node.firstElementChild && node.querySelector('img, source'))) {
                  hasMedia = true;
                  break;
                }
              }
            }
            if (hasMedia) break;
          }
          if (hasMedia) scheduleSync();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }

      scheduleSync();
    } catch (e) {
      console.warn('Media resolver init warning:', e);
    }
  }

function checkAndInit() {
  // Always initialize fallback index immediately (0ms synchronous)
  initPreseededTable();
  syncDocument();

  const db = window.__linkaddaDb || window._fbDB;
  if (db) {
    startResolver(db);
  } else {
    window.addEventListener('linkadda-firebase-ready', () => {
      const readyDb = window.__linkaddaDb || window._fbDB;
      if (readyDb) startResolver(readyDb);
    }, { once: true });

    let tries = 0;
    const interval = setInterval(() => {
      tries++;
      const currentDb = window.__linkaddaDb || window._fbDB;
      if (currentDb) {
        clearInterval(interval);
        startResolver(currentDb);
      } else if (tries > 20) {
        clearInterval(interval);
      }
    }, 250);
  }
}

checkAndInit();

// ==========================================================================
// LinkAdda Full-Screen Mobile E-Commerce App Controller
// True App Screen Router (No Drawers) & Clean 'Profile' Label
// ==========================================================================

// Clean Session & Router Controller (Zero External Auth Bloat)
const SESSION_KEY = 'linkadda_customer_session';

// Safe stubs for backward compatibility
export async function getFirebaseAuth() { return null; }
export async function checkGoogleRedirectResult() { return; }

// ━━ 0. STRING & HTML UTILITIES ━━
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

function sanitizeSafeActionUrl(url) {
  const clean = String(url || '').trim();
  if (/^(https?:\/\/|tg:\/\/)/i.test(clean)) {
    return escapeHtml(clean);
  }
  return '#';
}

// ━━ 1. CRYPTO & IDENTITY UTILITIES ━━
async function clientSha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getApiEndpoint(path) {
  if (typeof window === 'undefined') return path;
  const port = window.location.port;
  if ((port === '5500' || port === '5501' || port === '3000' || port === '8080' || !port) && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `http://localhost:8899${path}`;
  }
  return path;
}

export async function getCustomerId(email) {
  const clean = String(email || '').toLowerCase().trim();
  const hash = await clientSha256(clean);
  return `cust_${hash.substring(0, 16)}`;
}

// ━━ 2. UNIFIED SINGLE ACCOUNT RESOLVER ━━
export async function resolveUnifiedCustomer(email, incomingData = {}) {
  const cleanEmail = String(email || '').toLowerCase().trim();
  const uid = await getCustomerId(cleanEmail);
  const fallbackName = cleanEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  let existing = null;

  // 1. Check local session
  const local = getCustomerSession();
  if (local && local.email && local.email.toLowerCase() === cleanEmail) {
    existing = local;
  }

  // 2. Check remote database (parallel fast lookup) - skip if Google already provided a real name
  const hasRealName = (existing?.displayName && existing.displayName !== fallbackName && existing.displayName !== 'Customer') ||
                      (incomingData.provider === 'google' && incomingData.displayName && incomingData.displayName !== fallbackName);

  if (!hasRealName && !incomingData.newName) {
    try {
      const timeoutPromise = (ms) => new Promise(r => setTimeout(r, ms));
      const fetchApi = fetch(getApiEndpoint(`/api/auth/customer?email=${encodeURIComponent(cleanEmail)}`), { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null).catch(() => null);

      const [apiRes] = await Promise.race([
        Promise.all([fetchApi]),
        timeoutPromise(600).then(() => [null])
      ]);

      if (apiRes?.customer) existing = { ...existing, ...apiRes.customer };
    } catch (_) {}
  }

  // 5. Smart display name determination:
  // - If incoming explicit newName is provided, use it.
  // - If existing record already has a custom name (not default fallback), retain it.
  // - If Google provided a real name, use it.
  // - Otherwise use incoming displayName or fallback name.
  let finalDisplayName = fallbackName;
  let hasSavedCustomName = false;

  if (incomingData.newName && String(incomingData.newName).trim()) {
    finalDisplayName = String(incomingData.newName).trim();
    hasSavedCustomName = true;
  } else if (existing?.displayName && existing.displayName !== fallbackName && existing.displayName !== 'Customer') {
    finalDisplayName = existing.displayName;
    hasSavedCustomName = true;
  } else if (existing?.hasSavedName && existing.displayName) {
    finalDisplayName = existing.displayName;
    hasSavedCustomName = true;
  } else if (incomingData.provider === 'google' && incomingData.displayName && incomingData.displayName !== fallbackName) {
    finalDisplayName = incomingData.displayName;
    hasSavedCustomName = true;
  } else if (incomingData.displayName && String(incomingData.displayName).trim()) {
    finalDisplayName = String(incomingData.displayName).trim();
  }

  // Determine whether this user needs a first-time name prompt:
  // ONLY if they have never saved a name and didn't provide one via Google!
  const isNewUserWithNameNeeded = !hasSavedCustomName && incomingData.provider !== 'google';

  // 6. Merge providers list (supports logging in with Google or Email OTP interchangeably)
  const incomingProvider = incomingData.provider || existing?.provider || 'email_otp';
  const existingProviders = Array.isArray(existing?.providers)
    ? existing.providers
    : (existing?.provider ? [existing.provider] : []);
  const mergedProviders = Array.from(new Set([...existingProviders, incomingProvider].filter(Boolean)));

  // 7. Construct Unified Customer Profile (No Avatar Image!)
  const unifiedUser = {
    uid: uid,
    email: cleanEmail,
    displayName: finalDisplayName,
    hasSavedName: hasSavedCustomName,
    provider: incomingProvider,
    providers: mergedProviders,
    verified: true,
    createdAt: existing?.createdAt || Date.now(),
    lastLoginAt: Date.now(),
    isNewUserWithNameNeeded: isNewUserWithNameNeeded,
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(unifiedUser));
  syncCustomerToDatabase(unifiedUser);

  const welcomedKey = `linkadda_welcomed_${uid}`;
  if (!localStorage.getItem(welcomedKey)) {
    addUserWelcomeNotification(uid, unifiedUser.displayName);
  }

  window.dispatchEvent(new CustomEvent('linkadda:auth-changed', { detail: unifiedUser }));
  updateHeaderUserUI();

  return unifiedUser;
}

export function getCustomerSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export async function logoutCustomer() {
  try {
    const fb = await getFirebaseAuth();
    if (fb && fb.signOut && fb.auth) {
      await fb.signOut(fb.auth).catch(() => {});
    }
  } catch (_) {}
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent('linkadda:auth-changed', { detail: null }));
  updateHeaderUserUI();
  showProfilePage();
  showAppToast('You have been signed out.');
}

async function syncCustomerToDatabase(user) {
  if (!user || !user.uid) return;
  const payload = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    hasSavedName: user.hasSavedName !== undefined ? user.hasSavedName : true,
    provider: user.provider,
    providers: user.providers || (user.provider ? [user.provider] : ['email_otp']),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    newName: user.newName || undefined,
  };

  // 1. Backend Serverless API sync (with admin credentials, guarantees persistence!)
  try {
    fetch(getApiEndpoint('/api/auth/customer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (_) {}

  // 2. Direct Supabase sync to events table
  try {
    const supaUrl = 'https://esxiwfswnbacmpjxqgsn.supabase.co';
    const supaKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeGl3ZnN3bmJhY21wanhxZ3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MDcxODQsImV4cCI6MjEwODE4MzE4NH0.n6XzLxgH5947CK-224Tp57BJmbWZ_rTKi4PK-EW8bNI';
    fetch(`${supaUrl}/rest/v1/events`, {
      method: 'POST',
      headers: {
        'apikey': supaKey,
        'Authorization': `Bearer ${supaKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        event_type: 'customer_login',
        visitor_id: user.uid,
        data: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          provider: user.provider,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
        }
      }])
    }).catch(() => {});
  } catch (_) {}
}



// ━━ 4. UI HEADER UPDATER (STRICTLY 'SETTINGS') ━━
export function updateHeaderUserUI() {
  const headerBtn = document.getElementById('headerUserBtn');
  const mobBtn = document.getElementById('mobUserBtn');
  const appbarBtn = document.getElementById('appbarAccountBtn');

  // Desktop Header Button: 'Settings'
  if (headerBtn) {
    headerBtn.innerHTML = `
      <i class="fa-solid fa-gear" style="color: #ff2a8d; font-size: 1.05rem;"></i>
      <span class="fk-user-btn-text" id="headerUserBtnText">Settings</span>
    `;
    headerBtn.setAttribute('title', 'Settings & Preferences');
  }

  // Mobile Drawer Button
  if (mobBtn) {
    const mobText = document.getElementById('mobUserBtnText');
    if (mobText) {
      mobText.textContent = 'Settings';
    }
  }

  // Mobile Bottom App Bar Settings Tab
  if (appbarBtn) {
    appbarBtn.innerHTML = `
      <i class="fa-solid fa-gear" id="appbarAccountIcon" style="color: #ff2a8d;"></i>
      <span id="appbarAccountLabel">Settings</span>
    `;
    appbarBtn.setAttribute('aria-label', 'Settings');
  }
}

export function updateProfileAvatarUI(user) {
  const avatarInitialsEl = document.getElementById('profileAvatarInitials');
  const avatarStatusEl = document.getElementById('profileAvatarStatus');
  if (!avatarInitialsEl) return;

  if (user && user.displayName) {
    const rawName = user.displayName.trim();
    const parts = rawName.split(/\s+/).filter(Boolean);
    const initials = parts.length > 1 
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (parts[0] ? parts[0].slice(0, 2).toUpperCase() : 'LA');
    avatarInitialsEl.textContent = initials;
    if (avatarStatusEl) {
      avatarStatusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
      avatarStatusEl.style.display = 'flex';
      avatarStatusEl.title = 'Verified Customer';
    }
  } else if (user) {
    avatarInitialsEl.innerHTML = '<i class="fa-solid fa-user-check"></i>';
    if (avatarStatusEl) {
      avatarStatusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
      avatarStatusEl.style.display = 'flex';
      avatarStatusEl.title = 'Verified Customer';
    }
  } else {
    avatarInitialsEl.innerHTML = '<i class="fa-solid fa-crown"></i>';
    if (avatarStatusEl) {
      avatarStatusEl.style.display = 'none';
    }
  }
}

export function copyProfileAccountId() {
  const idEl = document.getElementById('profileDisplayId');
  const rawId = (idEl ? idEl.textContent : '').trim() || '#LA-STORE';

  const finishCopy = () => {
    const btn = document.getElementById('btnCopyProfileId');
    if (btn) {
      const origHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span class="copy-id-label">Copied!</span>';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = origHtml;
        btn.classList.remove('copied');
      }, 2200);
    }
    if (typeof showAppToast === 'function') {
      showAppToast(`Account ID ${rawId} copied to clipboard!`);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(rawId).then(finishCopy).catch(() => {
      fallbackCopy(rawId);
      finishCopy();
    });
  } else {
    fallbackCopy(rawId);
    finishCopy();
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_) {}
  }
}
window.copyProfileAccountId = copyProfileAccountId;
window.updateProfileAvatarUI = updateProfileAvatarUI;

// ━━ 5. FULL-PAGE NATIVE PROFILE SCREEN ROUTER ━━
export function showProfilePage() {
  const user = getCustomerSession();
  const storefrontView = document.getElementById('appStorefrontView');
  const accountView = document.getElementById('appAccountView');
  const searchView = document.getElementById('appSearchView');
  const notifsView = document.getElementById('appNotificationsView');
  const ordersView = document.getElementById('appOrdersView');
  if (!accountView) return;

  // 1. Switch View in normal document flow (100% native scrolling!)
  if (storefrontView) storefrontView.style.display = 'none';
  if (searchView) searchView.style.display = 'none';
  if (notifsView) notifsView.style.display = 'none';
  if (ordersView) ordersView.style.display = 'none';
  accountView.style.display = 'block';
  document.body.style.overflow = '';
  window.scrollTo(0, 0);

  // Responsive device view: on desktop (laptop/PC > 991px), keep main store header & floating cart active
  // On mobile/tablet (<= 991px), hide them to provide pure distraction-free native app screen
  const isDesktop = window.innerWidth > 991;
  const fkHeader = document.getElementById('fkHeader');
  const fkHeaderSpacer = document.getElementById('fkHeaderSpacer');
  const marqueeWrap = document.querySelector('.marquee-wrap');
  const floatingCart = document.getElementById('leftFloatingCart');
  if (fkHeader) fkHeader.style.display = isDesktop ? '' : 'none';
  if (fkHeaderSpacer) fkHeaderSpacer.style.display = isDesktop ? '' : 'none';
  if (marqueeWrap) marqueeWrap.style.display = 'none';
  if (floatingCart) floatingCart.style.display = 'none';

  // 2. Populate Customer Info / Guest State (Strictly Verified Member - No VIP!)
  const greetingEl = document.getElementById('profileGreetingName');
  const subtitleEl = document.getElementById('profileDisplaySubtitle');
  const emailEl = document.getElementById('profileDisplayEmail');
  const idEl = document.getElementById('profileDisplayId');
  const verifiedBadgeEl = document.getElementById('profileVerifiedBadge') || document.getElementById('profileVipBadge');
  const nameInput = document.getElementById('profileEditNameInput');
  const logoutWrap = document.getElementById('profileLogoutWrap');
  const guestCtaWrap = document.getElementById('profileGuestCtaWrap');
  const personalCard = document.getElementById('profilePersonalDetailsCard');

  updateProfileAvatarUI(user);

  if (greetingEl) greetingEl.textContent = (user && user.displayName) ? user.displayName : 'VIP Member';
  if (subtitleEl) subtitleEl.style.display = 'none';
  if (emailEl) emailEl.style.display = 'none';
  if (idEl) idEl.textContent = user ? `#LA-${(user.uid || '').slice(-6).toUpperCase()}` : '#LA-STORE';
  
  if (verifiedBadgeEl) {
    verifiedBadgeEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Verified Member</span>`;
    verifiedBadgeEl.style.display = 'inline-flex';
  }
  if (nameInput) nameInput.value = (user && user.displayName) || '';

  const joinedTextEl = document.getElementById('profileJoinedDateText');
  const joinedRowEl = document.getElementById('profileJoinedText');
  const joinedBadgeEl = document.getElementById('profileJoinedBadge');
  const joinedTimestamp = (user && user.createdAt) || Date.now();
  const joinedFormatted = new Date(joinedTimestamp).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

  if (joinedTextEl) joinedTextEl.textContent = joinedFormatted;
  if (joinedRowEl) joinedRowEl.style.display = 'flex';
  if (joinedBadgeEl) joinedBadgeEl.style.display = 'none';

  if (logoutWrap) logoutWrap.style.display = 'none';
  if (guestCtaWrap) guestCtaWrap.style.display = 'none';
  if (personalCard) personalCard.style.display = 'none';

  // 3. Render Orders List in Place (Native App Style)
  renderAccountOrders();

  // 4. Update live Wishlist & Cart counts
  const likesCountEl = document.getElementById('profileLikedCount');
  if (likesCountEl) {
    try {
      const rawLikes = localStorage.getItem('la_wishlist') || localStorage.getItem('linkadda_wishlist') || '[]';
      likesCountEl.textContent = `${JSON.parse(rawLikes).length || 0} Saved`;
    } catch (_) {
      likesCountEl.textContent = '0 Saved';
    }
  }

  const cartCountEl = document.getElementById('profileCartCount');
  if (cartCountEl) {
    try {
      const rawCart = localStorage.getItem('linkadda_cart_v1') || '[]';
      const cartList = JSON.parse(rawCart);
      let totalQty = 0;
      if (Array.isArray(cartList)) cartList.forEach(item => totalQty += (item.qty || 1));
      cartCountEl.textContent = `${totalQty} Items`;
    } catch (_) {
      cartCountEl.textContent = '0 Items';
    }
  }

  // Live Cart count badges sync (Top App Bar & Header)
  if (typeof window.updateCartBadges === 'function') {
    window.updateCartBadges();
  }

  // 5. Sync Theme Switch state
  const themeSwitch = document.getElementById('profileThemeSwitch');
  if (themeSwitch) {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    themeSwitch.checked = (currentTheme === 'dark');
  }

  // 6. Highlight bottom appbar Profile/Account tab
  document.querySelectorAll('.fk-appbar-item').forEach(el => el.classList.remove('active'));
  const appbarAccountBtn = document.getElementById('appbarAccountBtn');
  if (appbarAccountBtn) appbarAccountBtn.classList.add('active');

  // 7. Update History Hash & Notifications UI
  updateNotificationsUI();
  if (window.location.hash !== '#settings' && window.location.hash !== '#profile') {
    window.history.pushState({ screen: 'settings' }, '', '#settings');
  }
}

export function hideProfilePage(preventHistoryBack = false) {
  const storefrontView = document.getElementById('appStorefrontView');
  const accountView = document.getElementById('appAccountView');
  const ordersView = document.getElementById('appOrdersView');

  if (accountView) accountView.style.display = 'none';
  if (ordersView) ordersView.style.display = 'none';
  if (storefrontView) storefrontView.style.display = 'block';
  document.body.style.overflow = '';

  // Restore storefront header, marquee review ticker, and floating cart
  const fkHeader = document.getElementById('fkHeader');
  const fkHeaderSpacer = document.getElementById('fkHeaderSpacer');
  const marqueeWrap = document.querySelector('.marquee-wrap');
  const floatingCart = document.getElementById('leftFloatingCart');
  if (fkHeader) fkHeader.style.display = '';
  if (fkHeaderSpacer) fkHeaderSpacer.style.display = '';
  if (marqueeWrap) marqueeWrap.style.display = '';
  if (floatingCart) floatingCart.style.display = '';

  // Restore Home tab highlight
  document.querySelectorAll('.fk-appbar-item').forEach(el => el.classList.remove('active'));
  const homeTab = document.getElementById('appbarHomeTab');
  if (homeTab) homeTab.classList.add('active');

  if (!preventHistoryBack && window.location.hash === '#profile') {
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (_) {
      window.location.hash = '';
    }
  }
}

export function renderAccountOrders() {
  const countEl = document.getElementById('profileOrdersCount');
  const pillEl = document.getElementById('profileOrdersPill');

  // Trigger realtime order status sync from Firebase RTDB
  if (typeof syncUserOrdersWithFirebase === 'function') {
    syncUserOrdersWithFirebase().catch(() => {});
  }

  const orders = getUserOrders();
  const count = orders.length;

  if (countEl) countEl.textContent = `${count} ${count === 1 ? 'Order' : 'Orders'}`;
  if (pillEl) pillEl.textContent = `${count} ${count === 1 ? 'Order' : 'Orders'}`;

  const listEl = document.getElementById('accountOrdersList');
  if (listEl) {
    if (!count) {
      listEl.innerHTML = `
        <div class="orders-empty-state">
          <div class="orders-empty-icon"><i class="fa-solid fa-bag-shopping"></i></div>
          <h4 class="orders-empty-title">You haven't placed any orders yet</h4>
          <p class="orders-empty-sub">Your purchased creator collections, discrete download links, and receipts will appear here automatically.</p>
          <button type="button" class="btn-explore-orders" onclick="window.hideProfilePage && window.hideProfilePage();">
            <i class="fa-solid fa-bolt"></i> Explore Trending Packs
          </button>
        </div>
      `;
    } else {
      listEl.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
    }
  }
}

// ━━ 6. INTERACTIVE NAME SAVING & EDITING ━━
export async function saveCustomerName(newName) {
  const trimmed = String(newName || '').trim();
  if (!trimmed) {
    showAppToast('Please enter your full name.');
    return;
  }

  let user = getCustomerSession();
  if (!user || !user.email) {
    const emailInput = document.getElementById('authEmailInput');
    const fallbackEmail = currentEmail || (emailInput ? emailInput.value.trim() : '') || 'customer@linkadda.online';
    const computedUid = await getCustomerId(fallbackEmail);
    user = {
      uid: computedUid,
      email: fallbackEmail.toLowerCase().trim(),
      displayName: trimmed,
      hasSavedName: true,
      isNewUserWithNameNeeded: false,
      provider: 'email_otp',
      providers: ['email_otp'],
      verified: true,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
  } else {
    user.displayName = trimmed;
    user.hasSavedName = true;
    user.isNewUserWithNameNeeded = false;
  }

  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  syncCustomerToDatabase({ ...user, newName: trimmed, hasSavedName: true });

  const greetingEl = document.getElementById('profileGreetingName');
  if (greetingEl) greetingEl.textContent = trimmed;
  updateProfileAvatarUI(user);

  const nameInput = document.getElementById('profileEditNameInput');
  if (nameInput) nameInput.value = trimmed;

  // Visual button feedback
  const btnSave = document.getElementById('btnSaveProfileName');
  if (btnSave) {
    const origHtml = btnSave.innerHTML;
    btnSave.innerHTML = `<i class="fa-solid fa-circle-check"></i> Saved!`;
    btnSave.classList.add('saved');
    setTimeout(() => {
      btnSave.innerHTML = origHtml;
      btnSave.classList.remove('saved');
    }, 2200);
  }

  // Inline feedback banner
  const feedbackEl = document.getElementById('profileNameFeedback');
  if (feedbackEl) {
    feedbackEl.classList.add('visible');
    setTimeout(() => feedbackEl.classList.remove('visible'), 3200);
  }

  updateHeaderUserUI();
  addUserWelcomeNotification(user.uid, trimmed);
  showAppToast(`Name saved: "${trimmed}"!`);
}

// ━━ 6B. SETTINGS & PROFILE STUBS ━━
export function openEditProfileModal() {}
export function closeEditProfileModal() {}
export async function saveCustomerProfile() {}


// ━━ 7. AUTH MODAL CONTROLLERS (DISABLED) ━━
export function openAuthModal(step = 'input') {
  // Login modal disabled - purchases and navigation work directly without login
  return;
}

export function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
}

if (typeof window !== 'undefined') {
  window.openAuthModal = openAuthModal;
  window.closeAuthModal = closeAuthModal;
}

// ━━ 8. TOAST NOTIFICATION UTILITY ━━
export function showAppToast(message) {
  let toast = document.getElementById('laAppToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'laAppToast';
    toast.className = 'la-app-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #ff2a8d;"></i> <span>${escapeHtml(message)}</span>`;
  toast.classList.add('visible');
  setTimeout(() => {
    toast.classList.remove('visible');
  }, 2600);
}

// ━━ 9. EVENT LISTENERS INITIALIZATION ━━
function initAuthModalEvents() {
  // Modal Close triggers
  const closeBtn = document.getElementById('authModalCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeAuthModal);

  const modal = document.getElementById('authModal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeAuthModal();
    });
  }

  // Full-Screen Profile Screen: Back Button
  const btnBackProfile = document.getElementById('btnBackFromProfile');
  if (btnBackProfile) {
    btnBackProfile.addEventListener('click', () => hideProfilePage());
  }

  // Browser / Mobile back button listener (popstate)
  window.addEventListener('popstate', e => {
    const searchView = document.getElementById('appSearchView');
    if (searchView && searchView.style.display !== 'none') {
      if (window.location.hash !== '#search') {
        if (typeof window.hideSearchPage === 'function') {
          window.hideSearchPage(true);
        }
      }
      return;
    }
    const ordersView = document.getElementById('appOrdersView');
    if (ordersView && ordersView.style.display !== 'none') {
      if (window.location.hash !== '#orders') {
        hideOrdersPage(true);
      }
      return;
    }
    const notifsView = document.getElementById('appNotificationsView');
    if (notifsView && notifsView.style.display !== 'none') {
      if (window.location.hash !== '#notifications') {
        hideNotificationsPage(true);
      }
      return;
    }
    const accountView = document.getElementById('appAccountView');
    if (accountView && accountView.style.display !== 'none') {
      if (window.location.hash !== '#profile') {
        hideProfilePage(true);
      }
    }
  });

  // Check URL hash on page load
  if (window.location.hash === '#notifications') {
    showNotificationsPage('store');
  } else if (window.location.hash === '#orders') {
    showOrdersPage('store');
  } else if (window.location.hash === '#profile') {
    showProfilePage();
  } else if (window.location.hash === '#search') {
    if (typeof window.showSearchPage === 'function') {
      window.showSearchPage();
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (modal && modal.classList.contains('open')) closeAuthModal();
      const searchView = document.getElementById('appSearchView');
      if (searchView && searchView.style.display !== 'none') {
        if (typeof window.hideSearchPage === 'function') window.hideSearchPage();
      }
      const ordersView = document.getElementById('appOrdersView');
      if (ordersView && ordersView.style.display !== 'none') hideOrdersPage();
      const notifsView = document.getElementById('appNotificationsView');
      if (notifsView && notifsView.style.display !== 'none') hideNotificationsPage();
      const accountView = document.getElementById('appAccountView');
      if (accountView && accountView.style.display !== 'none') hideProfilePage();
    }
  });

  // Header User button: navigates to Full-Screen Profile Screen
  const headerBtn = document.getElementById('headerUserBtn');
  if (headerBtn) {
    headerBtn.addEventListener('click', e => {
      e.stopPropagation();
      showProfilePage();
    });
  }

  // Mobile Drawer User button
  const mobBtn = document.getElementById('mobUserBtn');
  if (mobBtn) {
    mobBtn.addEventListener('click', () => {
      const mobNav = document.getElementById('mobileNav');
      if (mobNav) mobNav.classList.remove('active');
      showProfilePage();
    });
  }

  // Mobile Bottom App Bar Account Tab click
  const appbarAccountBtn = document.getElementById('appbarAccountBtn');
  if (appbarAccountBtn) {
    appbarAccountBtn.addEventListener('click', () => {
      showProfilePage();
    });
  }

  // Mobile Bottom App Bar Home Tab click
  const appbarHomeTab = document.getElementById('appbarHomeTab');
  if (appbarHomeTab) {
    appbarHomeTab.addEventListener('click', () => {
      document.querySelectorAll('.fk-appbar-item').forEach(el => el.classList.remove('active'));
      appbarHomeTab.classList.add('active');
      hideProfilePage();
      closeUserOrdersModal();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Mobile Bottom App Bar Categories Tab click
  const appbarCategoriesTab = document.getElementById('appbarCategoriesTab');
  if (appbarCategoriesTab) {
    appbarCategoriesTab.addEventListener('click', () => {
      document.querySelectorAll('.fk-appbar-item').forEach(el => el.classList.remove('active'));
      appbarCategoriesTab.classList.add('active');
      hideProfilePage();
      closeUserOrdersModal();
      const sec = document.getElementById('categoryFilterPills') || document.getElementById('services');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Mobile Bottom App Bar Liked Tab click
  const appbarWishlistBtn = document.getElementById('fkAppbarWishlistBtn');
  if (appbarWishlistBtn) {
    appbarWishlistBtn.addEventListener('click', () => {
      hideProfilePage();
      closeUserOrdersModal();
    });
  }

  // Mobile Bottom App Bar Cart Tab click
  const appbarCartBtn = document.getElementById('fkAppbarCartBtn');
  if (appbarCartBtn) {
    appbarCartBtn.addEventListener('click', () => {
      hideProfilePage();
      closeUserOrdersModal();
    });
  }



  // Profile Screen: Theme Toggle Switch
  const themeSwitch = document.getElementById('profileThemeSwitch');
  if (themeSwitch) {
    themeSwitch.addEventListener('change', e => {
      if (typeof window.toggleStoreTheme === 'function') {
        window.toggleStoreTheme(e);
      }
    });
  }

  // Profile Screen: Liked Packs Shortcut
  const likedCard = document.getElementById('profileLikedCard');
  if (likedCard) {
    likedCard.addEventListener('click', () => {
      if (typeof window.openWishlistDrawer === 'function') {
        window.openWishlistDrawer();
      }
    });
  }

  // Profile Screen: My Cart Shortcut
  const cartCard = document.getElementById('profileCartCard');
  if (cartCard) {
    cartCard.addEventListener('click', () => {
      if (typeof window.openCartDrawer === 'function') {
        window.openCartDrawer();
      }
    });
  }

  // Profile Screen: Currency Toggle Info
  const mobCurrencyToggle = document.getElementById('mobCurrencyToggle');
  if (mobCurrencyToggle) {
    mobCurrencyToggle.addEventListener('click', () => {
      showAppToast('Simultaneous Dual Pricing: ₹ INR & $ USD are both active storewide.');
    });
  }

  // Profile Screen: My Orders Shortcut
  const ordersCard = document.getElementById('profileOrdersCard');
  if (ordersCard) {
    ordersCard.addEventListener('click', () => {
      openUserOrdersModal();
    });
  }



  // Initial UI Render
  updateHeaderUserUI();
}

// ━━ 10. USER ORDERS CONTROLLER & REALTIME APPROVAL SYNC ━━
export function getUserOrders() {
  try {
    const raw = localStorage.getItem('linkadda_user_orders') || '[]';
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

export function copyOrderLink(url, btn) {
  if (!url) return;
  const copyText = () => {
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Copied!</span>';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
    if (typeof showAppToast === 'function') {
      showAppToast('Link copied to clipboard! 📋');
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(copyText).catch(() => fallback());
  } else {
    fallback();
  }

  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); copyText(); } catch (_) {}
    document.body.removeChild(ta);
  }
}
window.copyOrderLink = copyOrderLink;

export function formatOrderCardHtml(ord) {
  if (!ord) return '';
  const isConfirmed = ord.status === 'confirmed' || ord.status === 'completed' || ord.status === 'paid' || ord.status === 'approved';
  const orderId = String(ord.orderId || 'LA-ORDER').slice(-10).toUpperCase();
  const safeTitle = escapeHtml(ord.productName || 'Exclusive Creator Collection');
  const safePrice = escapeHtml(ord.amountDisplay || '₹399');
  const safeDate = escapeHtml(ord.date || 'Recent');
  const specificLink = (ord.channelLink || ord.downloadLink || ord.fileUrl || '').trim();
  const hasSpecificLink = specificLink && (!specificLink.includes('VIP_KINK') && !specificLink.includes('VIP_KINK'));

  const tgMsg = `Hi Admin, I have placed order #${orderId} (${ord.productName || 'VIP Content Pack'}). Please verify and approve my payment.`;
  const tgUrl = `https://t.me/VIP_KINK?text=${encodeURIComponent(tgMsg)}`;
  const claimMsg = `Hi Admin, my order #${orderId} (${ord.productName || 'VIP Content Pack'}) is approved! Please provide my VIP Telegram access link.`;
  const claimUrl = `https://t.me/VIP_KINK?text=${encodeURIComponent(claimMsg)}`;

  let noteHtml = '';
  let actionHtml = '';

  if (isConfirmed) {
    if (hasSpecificLink) {
      noteHtml = `
        <div class="user-order-note confirmed" style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; border-radius: 8px; padding: 6px 10px; display: flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 4px;">
          <i class="fa-solid fa-circle-check"></i>
          <span>Order Approved! Your VIP Access Link is unlocked below.</span>
        </div>
      `;
      actionHtml = `
        <div class="user-order-actions" style="display: flex; gap: 8px; margin-top: 8px; align-items: stretch;">
          <a href="${escapeHtml(specificLink)}" target="_blank" rel="noopener" class="btn-order-access confirmed" style="flex: 1; text-align: center; text-decoration: none; justify-content: center; display: inline-flex; align-items: center; gap: 8px; font-weight: 700; padding: 10px 14px; border-radius: 12px; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff;">
            <i class="fa-brands fa-telegram"></i>
            <span>Join VIP Channel / Access Link</span>
          </a>
        </div>
      `;
    } else {
      noteHtml = `
        <div class="user-order-note confirmed" style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; border-radius: 8px; padding: 6px 10px; display: flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 4px;">
          <i class="fa-solid fa-circle-check"></i>
          <span>Order Approved! Message Admin on Telegram (@VIP_KINK) to claim your link.</span>
        </div>
      `;
      actionHtml = `
        <div class="user-order-actions" style="display: flex; gap: 8px; margin-top: 8px; align-items: stretch;">
          <a href="${claimUrl}" target="_blank" rel="noopener" class="btn-order-access confirmed" style="flex: 1; text-align: center; text-decoration: none; justify-content: center; display: inline-flex; align-items: center; gap: 8px; font-weight: 700; padding: 10px 14px; border-radius: 12px; background: linear-gradient(135deg, #0088cc, #0284c7); color: #ffffff;">
            <i class="fa-brands fa-telegram"></i>
            <span>Get Link from Admin (@VIP_KINK)</span>
          </a>
        </div>
      `;
    }
  } else {
    noteHtml = `
      <div class="user-order-note pending">
        <i class="fa-solid fa-hourglass-half"></i>
        <span>Order pending verification. Content access link will unlock automatically upon admin approval.</span>
      </div>
    `;
    actionHtml = `
      <a href="${tgUrl}" target="_blank" rel="noopener" class="btn-order-access pending">
        <i class="fa-brands fa-telegram"></i>
        <span>Order Pending · Send Payment Proof</span>
      </a>
    `;
  }

  return `
    <div class="user-order-item ${isConfirmed ? 'is-confirmed' : 'is-pending'}" id="user-order-${escapeHtml(ord.orderId || orderId)}">
      <div class="user-order-top">
        <span class="user-order-id">#${escapeHtml(orderId)}</span>
        <span class="user-order-status ${isConfirmed ? 'confirmed' : 'pending'}">
          <i class="fa-solid ${isConfirmed ? 'fa-circle-check' : 'fa-clock'}"></i>
          ${isConfirmed ? 'Confirmed' : 'Pending Approval'}
        </span>
      </div>
      <div class="user-order-title">${safeTitle}</div>
      <div class="user-order-meta">
        <span class="user-order-price">${safePrice}</span>
        <span><i class="fa-regular fa-clock"></i> ${safeDate}</span>
      </div>
      ${noteHtml}
      ${actionHtml}
    </div>
  `;
}

let syncOrdersInProgress = false;
export async function syncUserOrdersWithFirebase() {
  if (syncOrdersInProgress) return;
  const orders = getUserOrders();
  if (!orders || !orders.length) return;

  syncOrdersInProgress = true;
  let hasUpdates = false;

  try {
    for (const ord of orders) {
      if (!ord || !ord.orderId) continue;
      // Skip only if already confirmed AND link is resolved
      if ((ord.status === 'confirmed' || ord.status === 'completed') && (ord.downloadLink || ord.fileUrl || ord.orderLink)) continue;

      try {
        let remoteOrder = null;
        let isApproved = false;
        let link = '';

        const supaUrl = 'https://esxiwfswnbacmpjxqgsn.supabase.co';
        const supaKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeGl3ZnN3bmJhY21wanhxZ3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MDcxODQsImV4cCI6MjEwODE4MzE4NH0.n6XzLxgH5947CK-224Tp57BJmbWZ_rTKi4PK-EW8bNI';
        const supaHdrs = { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}` };

        const res = await fetch(`${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(ord.orderId)}&select=*`, { headers: supaHdrs });
        if (res.ok) {
          const rows = await res.json();
          if (rows && rows.length) {
            remoteOrder = rows[0].data || rows[0];
          }
        }

        if (remoteOrder) {
          if (!isApproved) {
            isApproved = 
              remoteOrder.status === 'paid' || 
              remoteOrder.status === 'approved' || 
              remoteOrder.status === 'confirmed' || 
              remoteOrder.status === 'completed' ||
              remoteOrder.orderStatus === 'approved' ||
              remoteOrder.orderStatus === 'completed' ||
              remoteOrder.paymentStatus === 'paid' ||
              remoteOrder.paymentStatus === 'approved';
          }

          if (isApproved) {
            const wasPending = ord.status !== 'confirmed' && ord.status !== 'completed';
            ord.status = 'confirmed';
            if (!link) {
              link = remoteOrder.channelLink || remoteOrder.downloadLink || remoteOrder.fileUrl || '';
              if ((link.includes('VIP_KINK') || link.includes('VIP_KINK'))) link = '';
            }

            // If order doesn't have link, fetch from original product in Supabase
            if (!link && (remoteOrder.productId || ord.productId)) {
              try {
                const pId = remoteOrder.productId || ord.productId;
                const pRes = await fetch(`${supaUrl}/rest/v1/products?id=eq.${encodeURIComponent(pId)}&select=*`, { headers: supaHdrs });
                if (pRes.ok) {
                  const pRows = await pRes.json();
                  if (pRows && pRows.length) {
                    const prodData = pRows[0].data || pRows[0];
                    link = prodData.channelLink || prodData.deliveryLink || '';
                    if ((link.includes('VIP_KINK') || link.includes('VIP_KINK'))) link = '';
                  }
                }
              } catch (_) {}
            }

            ord.channelLink = link || '';
            ord.downloadLink = link || '';
            ord.fileUrl = link || '';
            ord.orderLink = link || '';


            hasUpdates = true;
            if (wasPending) {
              addOrderConfirmedNotification(ord);
            }
          }
        }
      } catch (e) {
        console.warn('Order sync check notice:', e);
      }
    }

    if (hasUpdates) {
      localStorage.setItem('linkadda_user_orders', JSON.stringify(orders));
      const listEl = document.getElementById('accountOrdersList');
      if (listEl) {
        listEl.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
      }
      const appOrdersList = document.getElementById('appOrdersList');
      if (appOrdersList) {
        appOrdersList.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
      }
      const appOrdersPageList = document.getElementById('appOrdersPageList');
      if (appOrdersPageList) {
        appOrdersPageList.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
      }
      const ordersPill = document.getElementById('ordersPageCountPill');
      if (ordersPill) {
        ordersPill.textContent = `${orders.length} ${orders.length === 1 ? 'Order' : 'Orders'}`;
      }
      if (typeof window.renderOrdersDrawer === 'function') {
        window.renderOrdersDrawer();
      }
      if (typeof window.updateOrdersBadge === 'function') {
        window.updateOrdersBadge();
      }
    }
  } finally {
    syncOrdersInProgress = false;
  }
}

export function addOrderConfirmedNotification(ord) {
  try {
    const user = getCustomerSession();
    const uid = user ? user.uid : 'guest';
    const notifsKey = `linkadda_notifs_${uid}`;
    let list = [];
    try {
      const raw = localStorage.getItem(notifsKey);
      if (raw) list = JSON.parse(raw);
    } catch (_) {}

    const rawId = String(ord.orderId || '');
    const orderId = rawId.slice(-10).toUpperCase();
    const notifId = `notif_order_${rawId}_confirmed`;

    // Deduplicate
    if (list.some(n => n.id === notifId)) return;

    const adminDmUrl = 'https://t.me/VIP_KINK';
    const productName = ord.productName || ord.name || ord.title || 'VIP Content Pack';
    const eventTime = ord.reviewedAt || ord.approvedAt || ord.timestamp || Date.now();

    const notifItem = {
      id: notifId,
      type: 'order_confirmed',
      orderId: rawId,
      productName: productName,
      title: `Order #${orderId} Approved! 🎉`,
      desc: `Your order #${orderId} has been verified and approved! To claim your content access, direct message Admin on Telegram: @VIP_KINK`,
      timestamp: eventTime,
      time: formatRelativeTime(eventTime),
      actionUrl: adminDmUrl,
      actionText: 'Contact Admin on Telegram (@VIP_KINK)',
      unread: true,
      icon: 'fa-circle-check',
      theme: 'success'
    };

    list.unshift(notifItem);
    localStorage.setItem(notifsKey, JSON.stringify(list));
    localStorage.removeItem(NOTIFS_READ_KEY); // Re-trigger unread badge indicator

    updateNotificationsUI();
    renderNotificationsPage();

    showAppToast(`🎉 Order #${orderId} approved! Message Admin on Telegram for instant access: @VIP_KINK`);
  } catch (err) {
    console.warn('Order confirmed notification notice:', err);
  }
}

export function checkAndResumePendingCheckout() {
  try {
    const pendingUrl = sessionStorage.getItem('pending_checkout_url');
    const pendingAction = sessionStorage.getItem('pending_checkout_action');

    if (pendingUrl) {
      sessionStorage.removeItem('pending_checkout_url');
      showAppToast('Resuming your checkout...');
      setTimeout(() => {
        window.location.href = pendingUrl;
      }, 350);
      return true;
    }

    if (pendingAction === 'cart') {
      sessionStorage.removeItem('pending_checkout_action');
      showAppToast('Resuming cart checkout...');
      setTimeout(() => {
        if (typeof window.openCartDrawer === 'function') {
          window.openCartDrawer();
        }
        const checkoutBtn = document.getElementById('cartCheckoutBtn');
        if (checkoutBtn) checkoutBtn.click();
      }, 400);
      return true;
    }
  } catch (err) {
    console.warn('Resume checkout notice:', err);
  }
  return false;
}

export function openUserOrdersModal() {
  const modal = document.getElementById('appOrdersModal');
  const listEl = document.getElementById('appOrdersList');
  const badgeEl = document.getElementById('appOrdersCountBadge');
  if (!modal || !listEl) return;

  syncUserOrdersWithFirebase().catch(() => {});

  const orders = getUserOrders();
  if (badgeEl) badgeEl.textContent = orders.length;

  if (!orders.length) {
    listEl.innerHTML = `
      <div class="orders-empty-state">
        <div class="orders-empty-icon"><i class="fa-solid fa-receipt"></i></div>
        <h4 class="orders-empty-title">No Orders Placed Yet</h4>
        <p class="orders-empty-sub">Your orders and instant download access links will appear here immediately after checkout.</p>
        <button type="button" class="btn-explore-orders" onclick="window.closeUserOrdersModal && window.closeUserOrdersModal(); window.hideProfilePage && window.hideProfilePage();">
          <i class="fa-solid fa-bolt"></i> Explore Best Deals
        </button>
      </div>
    `;
  } else {
    listEl.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
  }

  modal.classList.add('open');
}

export function closeUserOrdersModal() {
  const modal = document.getElementById('appOrdersModal');
  if (modal) modal.classList.remove('open');
}

// ━━ 11. FULL-PAGE NOTIFICATIONS SYSTEM CONTROLLER (NATIVE PAGE TYPE) ━━

const NOTIFS_READ_KEY = 'linkadda_notifs_read_v1';
let notifsPreviousScreen = 'profile';

export function addUserWelcomeNotification(uid, name) {
  try {
    const cleanUid = uid || 'guest';
    const welcomedKey = `linkadda_welcomed_${cleanUid}`;
    const notifsKey = `linkadda_notifs_${cleanUid}`;
    let list = [];
    try {
      const raw = localStorage.getItem(notifsKey);
      if (raw) list = JSON.parse(raw);
    } catch (_) {}

    const cleanName = name || 'Customer';
    const welcomeItem = {
      id: `welcome_${cleanUid}`,
      type: 'welcome',
      title: `Welcome to LinkAdda, ${cleanName}! 🎉`,
      desc: `Your verified customer account has been created successfully. All purchases, discrete receipts, and 24/7 Telegram download links are now active.`,
      time: 'Just now',
      unread: true,
      icon: 'fa-gift',
      theme: 'welcome'
    };

    list = list.filter(n => n.type !== 'welcome');
    list.unshift(welcomeItem);
    localStorage.setItem(notifsKey, JSON.stringify(list));
    localStorage.setItem(welcomedKey, 'true');
    updateNotificationsUI();
    renderNotificationsPage();
  } catch (err) {
    console.warn('Welcome notif error:', err);
  }
}

export function formatRelativeTime(ts) {
  if (!ts) return 'Just now';
  let time = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(time)) {
    if (typeof ts === 'string') return ts;
    return 'Just now';
  }
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - time) / 1000));
  if (diffSec < 60) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) {
    const d = new Date(time);
    return `Yesterday, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (days < 7) return `${days}d ago`;
  const d = new Date(time);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function getUserNotifications() {
  const user = getCustomerSession();
  const uid = user ? user.uid : 'guest';
  const key = `linkadda_notifs_${uid}`;
  
  let list = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) list = JSON.parse(raw);
  } catch (_) {}

  // Auto-migrate legacy cached items: remove any "download" wording and ensure timestamps exist
  let listModified = false;
  list = list.map(item => {
    if (!item.timestamp && item.time) {
      item.timestamp = Date.now() - 180000;
      listModified = true;
    }
    if (item.desc && (item.desc.includes('download') || item.desc.includes('Download') || item.desc.includes('VIP content aur'))) {
      item.desc = item.desc
        .replace(/VIP content aur download link ke liye Telegram par message karein\.?/gi, 'VIP Telegram access unlocked. Tap to view message and contact Admin.')
        .replace(/VIP Telegram Channel \/ Group access unlock ho chuka hai\. Tap karke message padhein aur join karein\.?/gi, 'VIP Telegram access unlocked. Tap to view message and contact Admin.')
        .replace(/download link/gi, 'Telegram VIP link')
        .replace(/download/gi, 'access');
      listModified = true;
    }
    if (item.actionText && (item.actionText.includes('Download') || item.actionText.includes('Content Link'))) {
      item.actionText = 'Join Telegram VIP Channel / Group';
      listModified = true;
    }
    return item;
  });
  if (listModified) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (_) {}
  }

  // If user is logged in, ensure Welcome Notification exists
  if (user) {
    const welcomedKey = `linkadda_welcomed_${user.uid}`;
    const hasWelcomed = localStorage.getItem(welcomedKey);
    const hasWelcomeInList = list.some(n => n.type === 'welcome');
    if (!hasWelcomed || !hasWelcomeInList) {
      const welcomeItem = {
        id: `welcome_${user.uid}`,
        type: 'welcome',
        title: `Welcome to LinkAdda, ${user.displayName || 'Customer'}! 🎉`,
        desc: `Your verified customer account has been created. Instant Telegram delivery and discrete order receipts are active 24/7.`,
        timestamp: Date.now(),
        time: 'Just now',
        unread: true,
        icon: 'fa-gift',
        theme: 'welcome'
      };
      list.unshift(welcomeItem);
      localStorage.setItem(welcomedKey, 'true');
      try {
        localStorage.setItem(key, JSON.stringify(list));
      } catch (_) {}
    }
  }

  // Ensure default announcements exist
  const hasSystemInstant = list.some(n => n.id === 'notif_instant');
  const hasSystemDrops = list.some(n => n.id === 'notif_drops');
  if (!hasSystemInstant) {
    list.push({
      id: 'notif_instant',
      type: 'system',
      title: 'Instant Telegram Delivery Online 24/7',
      desc: 'Automated delivery bot is operating at full speed. All purchased video collections deliver direct Telegram VIP Channel links instantly with zero delay.',
      timestamp: Date.now() - 3600000,
      time: '1h ago',
      unread: false,
      icon: 'fa-bolt',
      theme: 'instant'
    });
  }
  if (!hasSystemDrops) {
    list.push({
      id: 'notif_drops',
      type: 'system',
      title: 'Daily 4K Creator Drops',
      desc: 'Exclusive ultra-HD creator collections added today. Browse trending categories to claim limited-time offer bundles.',
      timestamp: Date.now() - 7200000,
      time: '2h ago',
      unread: false,
      icon: 'fa-fire',
      theme: 'drop'
    });
  }

  return list;
}

export function updateNotificationsUI() {
  const notifs = getUserNotifications();
  const unreadCount = notifs.filter(n => n.unread).length;
  
  const topDot = document.getElementById('appbarNotifDot');
  const headerDot = document.getElementById('headerNotifDot');
  const hubBadge = document.getElementById('profileNotifCount');
  const optionBadge = document.getElementById('profileOptionNotifBadge');
  const pageUnreadBadge = document.getElementById('notifPageUnreadCount');
  const markReadBtn = document.getElementById('btnTopMarkNotifsRead');

  if (topDot) topDot.style.display = unreadCount > 0 ? 'block' : 'none';
  if (headerDot) headerDot.style.display = unreadCount > 0 ? 'block' : 'none';

  if (hubBadge) {
    hubBadge.textContent = unreadCount > 0 ? `${unreadCount} New` : '0 New';
    hubBadge.style.opacity = unreadCount > 0 ? '1' : '0.6';
  }

  if (optionBadge) {
    optionBadge.textContent = unreadCount > 0 ? `${unreadCount} New` : '0 New';
    optionBadge.style.opacity = unreadCount > 0 ? '1' : '0.6';
  }

  if (pageUnreadBadge) {
    pageUnreadBadge.textContent = unreadCount > 0 ? `${unreadCount} Unread` : 'All Caught Up';
    pageUnreadBadge.className = unreadCount > 0 ? 'notif-page-unread-pill has-unread' : 'notif-page-unread-pill';
  }

  if (markReadBtn) {
    if (unreadCount === 0) {
      markReadBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> <span>All Read</span>`;
      markReadBtn.classList.add('all-read');
    } else {
      markReadBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> <span>Mark all</span>`;
      markReadBtn.classList.remove('all-read');
    }
  }
}

export function renderNotificationsPage() {
  const listEl = document.getElementById('notifPageList');
  if (!listEl) return;

  const notifs = getUserNotifications();
  if (!notifs.length) {
    listEl.innerHTML = `
      <div class="notif-empty-state">
        <div class="notif-empty-icon"><i class="fa-regular fa-bell-slash"></i></div>
        <h4 class="notif-empty-title">No notifications yet</h4>
        <p class="notif-empty-sub">When you receive order updates, delivery links, or deals, they will appear here.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = notifs.map(n => {
    const timeDisplay = formatRelativeTime(n.timestamp || n.time);
    return `
      <div class="notif-page-card clickable ${n.unread ? 'unread' : ''}" id="notif-item-${escapeHtml(n.id)}" onclick="window.handleNotificationCardClick && window.handleNotificationCardClick('${escapeHtml(n.id)}', event)" role="button" tabindex="0">
        <div class="notif-page-card-icon ${escapeHtml(n.theme || 'default')}">
          <i class="fa-solid ${escapeHtml(n.icon || 'fa-bell')}"></i>
        </div>
        <div class="notif-page-card-body">
          <div class="notif-page-card-head">
            <h4 class="notif-page-card-title">
              ${escapeHtml(n.title)}
              ${n.unread ? '<span class="notif-unread-dot" title="Unread"></span>' : ''}
            </h4>
            <span class="notif-page-card-time">${escapeHtml(timeDisplay)}</span>
          </div>
          <p class="notif-page-card-desc">${escapeHtml(n.desc)}</p>
          <div class="notif-card-footer">
            <span class="notif-tap-hint">
              <i class="fa-solid ${n.type === 'order_confirmed' ? 'fa-brands fa-telegram' : 'fa-envelope-open-text'}"></i>
              ${n.type === 'order_confirmed' ? 'VIP Channel Link Inside • Tap to Read' : 'Tap to Read Message'}
            </span>
            <span class="notif-chevron"><i class="fa-solid fa-angle-right"></i></span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export function handleNotificationCardClick(notifId, event) {
  if (event) event.stopPropagation();
  const user = getCustomerSession();
  const uid = user ? user.uid : 'guest';
  const key = `linkadda_notifs_${uid}`;
  
  let list = getUserNotifications();
  const target = list.find(n => n.id === notifId);
  if (!target) return;

  // 1. Mark as read immediately
  if (target.unread) {
    target.unread = false;
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch (_) {}
    updateNotificationsUI();
    const cardEl = document.getElementById(`notif-item-${notifId}`);
    if (cardEl) {
      cardEl.classList.remove('unread');
      const dot = cardEl.querySelector('.notif-unread-dot');
      if (dot) dot.remove();
    }
  }

  // 2. Open rich detail modal
  openNotificationDetailModal(target);
}

export function openNotificationDetailModal(notif) {
  const modal = document.getElementById('notifDetailModal');
  if (!modal) return;

  const titleEl = document.getElementById('notifDetailTitle');
  const timeEl = document.getElementById('notifDetailTime');
  const iconEl = document.getElementById('notifDetailIcon');
  const msgEl = document.getElementById('notifDetailMessageText');
  const orderBox = document.getElementById('notifDetailOrderBox');
  const itemNameEl = document.getElementById('notifDetailItemName');
  const orderIdEl = document.getElementById('notifDetailOrderId');
  const actionWrap = document.getElementById('notifDetailActionContainer');
  const ctaBtn = document.getElementById('notifDetailVipLinkBtn');
  const ctaBtnLabel = document.getElementById('notifDetailVipBtnLabel');
  const statusPill = document.getElementById('notifDetailStatusPill');
  const statusText = document.getElementById('notifDetailStatusText');

  if (titleEl) titleEl.textContent = notif.title || 'Notification Message';
  
  // Format exact date & time
  let exactTimeText = notif.time || 'Just now';
  if (notif.timestamp) {
    const d = new Date(notif.timestamp);
    exactTimeText = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (timeEl) timeEl.textContent = exactTimeText;

  if (iconEl) {
    iconEl.className = `notif-detail-icon-wrap ${notif.theme || 'default'}`;
    iconEl.innerHTML = `<i class="fa-solid ${escapeHtml(notif.icon || 'fa-bell')}"></i>`;
  }

  if (msgEl) {
    msgEl.textContent = notif.desc || '';
  }

  if (notif.type === 'order_confirmed') {
    if (statusPill) statusPill.style.display = 'inline-flex';
    if (statusText) statusText.textContent = 'Order Verified & Approved';
    if (orderBox) orderBox.style.display = 'flex';
    if (itemNameEl) itemNameEl.textContent = notif.productName || 'VIP Content Pack';
    if (orderIdEl) orderIdEl.textContent = '#' + String(notif.orderId || '').slice(-10).toUpperCase();

    const link = notif.actionUrl || 'https://t.me/VIP_KINK';
    if (actionWrap) actionWrap.style.display = 'flex';
    if (ctaBtn) {
      ctaBtn.href = link;
      ctaBtn.dataset.url = link;
    }
    if (ctaBtnLabel) {
      ctaBtnLabel.textContent = 'Contact Admin on Telegram (@VIP_KINK)';
    }
  } else if (notif.actionUrl) {
    if (statusPill) statusPill.style.display = 'none';
    if (orderBox) orderBox.style.display = 'none';
    if (actionWrap) actionWrap.style.display = 'flex';
    if (ctaBtn) {
      ctaBtn.href = notif.actionUrl;
      ctaBtn.dataset.url = notif.actionUrl;
    }
    if (ctaBtnLabel) {
      ctaBtnLabel.textContent = notif.actionText || 'Open Telegram Link';
    }
  } else {
    if (statusPill) statusPill.style.display = 'none';
    if (orderBox) orderBox.style.display = 'none';
    if (actionWrap) actionWrap.style.display = 'none';
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closeNotificationDetailModal() {
  const modal = document.getElementById('notifDetailModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

export async function copyNotifVipLink(btnEl) {
  const ctaBtn = document.getElementById('notifDetailVipLinkBtn');
  const url = ctaBtn ? (ctaBtn.dataset.url || ctaBtn.href) : '';
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    if (btnEl) {
      const orig = btnEl.innerHTML;
      btnEl.innerHTML = '<i class="fa-solid fa-check" style="color:#10b981;"></i> <span>Copied VIP Link!</span>';
      setTimeout(() => { btnEl.innerHTML = orig; }, 2000);
    }
    showAppToast('✅ Telegram VIP Link copied to clipboard!');
  } catch (_) {
    showAppToast('VIP Link: ' + url);
  }
}

export function showNotificationsPage(fromScreen = 'profile') {
  notifsPreviousScreen = fromScreen;
  const storefrontView = document.getElementById('appStorefrontView');
  const accountView = document.getElementById('appAccountView');
  const notifsView = document.getElementById('appNotificationsView');
  const ordersView = document.getElementById('appOrdersView');
  const searchView = document.getElementById('appSearchView');
  if (!notifsView) return;

  if (storefrontView) storefrontView.style.display = 'none';
  if (accountView) accountView.style.display = 'none';
  if (ordersView) ordersView.style.display = 'none';
  if (searchView) searchView.style.display = 'none';
  notifsView.style.display = 'block';

  // Responsive device view: on desktop (laptop/PC > 991px), keep main store header active
  const isDesktop = window.innerWidth > 991;
  const fkHeader = document.getElementById('fkHeader');
  const fkHeaderSpacer = document.getElementById('fkHeaderSpacer');
  const marqueeWrap = document.querySelector('.marquee-wrap');
  const floatingCart = document.getElementById('leftFloatingCart');
  if (fkHeader) fkHeader.style.display = isDesktop ? '' : 'none';
  if (fkHeaderSpacer) fkHeaderSpacer.style.display = isDesktop ? '' : 'none';
  if (marqueeWrap) marqueeWrap.style.display = 'none';
  if (floatingCart) floatingCart.style.display = isDesktop ? '' : 'none';

  document.body.style.overflow = '';
  window.scrollTo(0, 0);

  const backLabel = document.getElementById('notifsBackBtnLabel');
  if (backLabel) {
    backLabel.textContent = fromScreen === 'store' ? 'Store' : fromScreen === 'orders' ? 'Orders' : 'Profile';
  }

  // Instant order sync when notifications page is opened
  syncUserOrdersWithFirebase().catch(() => {});

  renderNotificationsPage();
  updateNotificationsUI();

  if (window.location.hash !== '#notifications') {
    window.history.pushState({ screen: 'notifications', from: fromScreen }, '', '#notifications');
  }
}

export function hideNotificationsPage(preventHistoryBack = false) {
  const notifsView = document.getElementById('appNotificationsView');
  if (notifsView) notifsView.style.display = 'none';

  if (notifsPreviousScreen === 'orders') {
    showOrdersPage();
  } else if (notifsPreviousScreen === 'profile') {
    showProfilePage();
  } else {
    hideProfilePage();
  }

  if (!preventHistoryBack && window.location.hash === '#notifications') {
    window.history.back();
  }
}

// ━━ 12. DEDICATED FULL-PAGE ORDERS SCREEN CONTROLLER (NATIVE PAGE TYPE) ━━
let ordersPreviousScreen = 'profile';

export function showOrdersPage(fromScreen = 'profile') {
  ordersPreviousScreen = fromScreen;
  const storefrontView = document.getElementById('appStorefrontView');
  const accountView = document.getElementById('appAccountView');
  const notifsView = document.getElementById('appNotificationsView');
  const searchView = document.getElementById('appSearchView');
  const ordersView = document.getElementById('appOrdersView');
  if (!ordersView) return;

  if (storefrontView) storefrontView.style.display = 'none';
  if (accountView) accountView.style.display = 'none';
  if (notifsView) notifsView.style.display = 'none';
  if (searchView) searchView.style.display = 'none';
  ordersView.style.display = 'block';

  // Responsive device view: on desktop (laptop/PC > 991px), keep main store header & floating cart active
  const isDesktop = window.innerWidth > 991;
  const fkHeader = document.getElementById('fkHeader');
  const fkHeaderSpacer = document.getElementById('fkHeaderSpacer');
  const marqueeWrap = document.querySelector('.marquee-wrap');
  const floatingCart = document.getElementById('leftFloatingCart');
  if (fkHeader) fkHeader.style.display = isDesktop ? '' : 'none';
  if (fkHeaderSpacer) fkHeaderSpacer.style.display = isDesktop ? '' : 'none';
  if (marqueeWrap) marqueeWrap.style.display = 'none';
  if (floatingCart) floatingCart.style.display = isDesktop ? '' : 'none';

  document.body.style.overflow = '';
  window.scrollTo(0, 0);

  const backLabel = document.getElementById('ordersBackBtnLabel');
  if (backLabel) {
    backLabel.textContent = fromScreen === 'store' ? 'Store' : 'Profile';
  }

  // Update cart badges
  if (typeof window.updateCartBadges === 'function') {
    window.updateCartBadges();
  }

  // Instant order sync with Firebase RTDB
  if (typeof syncUserOrdersWithFirebase === 'function') {
    syncUserOrdersWithFirebase().catch(() => {});
  }

  renderOrdersPage();

  if (window.location.hash !== '#orders') {
    window.history.pushState({ screen: 'orders', from: fromScreen }, '', '#orders');
  }
}

export function hideOrdersPage(preventHistoryBack = false) {
  const ordersView = document.getElementById('appOrdersView');
  if (ordersView) ordersView.style.display = 'none';

  if (ordersPreviousScreen === 'profile') {
    showProfilePage();
  } else {
    hideProfilePage();
  }

  if (!preventHistoryBack && window.location.hash === '#orders') {
    window.history.back();
  }
}

export function renderOrdersPage(filterQuery = '') {
  const listEl = document.getElementById('appOrdersPageList');
  const countPill = document.getElementById('ordersPageCountPill');
  if (!listEl) return;



  const allOrders = getUserOrders();
  let orders = allOrders;

  if (filterQuery && filterQuery.trim()) {
    const q = filterQuery.trim().toLowerCase();
    orders = allOrders.filter(o => 
      (o.orderId && String(o.orderId).toLowerCase().includes(q)) ||
      (o.productName && String(o.productName).toLowerCase().includes(q)) ||
      (o.status && String(o.status).toLowerCase().includes(q)) ||
      (o.date && String(o.date).toLowerCase().includes(q))
    );
  }

  if (countPill) {
    countPill.textContent = `${allOrders.length} ${allOrders.length === 1 ? 'Order' : 'Orders'}`;
  }

  // Also sync profile count pills
  const countEl = document.getElementById('profileOrdersCount');
  const pillEl = document.getElementById('profileOrdersPill');
  if (countEl) countEl.textContent = `${allOrders.length} ${allOrders.length === 1 ? 'Order' : 'Orders'}`;
  if (pillEl) pillEl.textContent = `${allOrders.length} ${allOrders.length === 1 ? 'Order' : 'Orders'}`;

  if (!orders.length) {
    if (filterQuery) {
      listEl.innerHTML = `
        <div class="orders-empty-state">
          <div class="orders-empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
          <h4 class="orders-empty-title">No matching orders found</h4>
          <p class="orders-empty-sub">No purchases match "${escapeHtml(filterQuery)}". Try another search keyword.</p>
        </div>
      `;
    } else {
      listEl.innerHTML = `
        <div class="orders-empty-state">
          <div class="orders-empty-icon"><i class="fa-solid fa-bag-shopping"></i></div>
          <h4 class="orders-empty-title">You haven't placed any orders yet</h4>
          <p class="orders-empty-sub">Your purchased creator collections, discrete download links, and receipts will appear here automatically.</p>
          <button type="button" class="btn-explore-orders" onclick="window.hideOrdersPage && window.hideOrdersPage();">
            <i class="fa-solid fa-bolt"></i> Explore Trending Packs
          </button>
        </div>
      `;
    }
  } else {
    listEl.innerHTML = orders.map(ord => formatOrderCardHtml(ord)).join('');
  }
}

export function filterOrdersList(q) {
  renderOrdersPage(q);
}

export async function refreshUserOrders() {
  const btn = document.querySelector('.btn-refresh-orders i');
  if (btn) btn.classList.add('fa-spin');
  try {
    if (typeof syncUserOrdersWithFirebase === 'function') {
      await syncUserOrdersWithFirebase();
    }
  } catch (_) {}
  setTimeout(() => {
    if (btn) btn.classList.remove('fa-spin');
    renderOrdersPage();
    if (typeof showAppToast === 'function') {
      showAppToast('Orders refreshed.');
    }
  }, 600);
}

export function markNotificationsAsRead() {
  const user = getCustomerSession();
  const uid = user ? user.uid : 'guest';
  const key = `linkadda_notifs_${uid}`;
  
  const list = getUserNotifications().map(n => ({ ...n, unread: false }));
  try {
    localStorage.setItem(key, JSON.stringify(list));
    localStorage.setItem(NOTIFS_READ_KEY, 'true');
  } catch (_) {}
  
  updateNotificationsUI();
  renderNotificationsPage();
  showAppToast('All notifications marked as read.');
}

export function openNameModal() {
  openAuthModal('name');
}

// Global exposure
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.openNameModal = openEditProfileModal; // upgraded from simple name modal to full profile edit!
window.openEditProfileModal = openEditProfileModal;
window.closeEditProfileModal = closeEditProfileModal;
window.saveCustomerProfile = saveCustomerProfile;
window.showProfilePage = showProfilePage;
window.hideProfilePage = hideProfilePage;
window.showNotificationsPage = showNotificationsPage;
window.hideNotificationsPage = hideNotificationsPage;
window.showOrdersPage = showOrdersPage;
window.hideOrdersPage = hideOrdersPage;
window.renderOrdersPage = renderOrdersPage;
window.filterOrdersList = filterOrdersList;
window.refreshUserOrders = refreshUserOrders;
window.openNotificationsModal = showNotificationsPage; // backward compatibility
window.closeNotificationsModal = hideNotificationsPage; // backward compatibility
window.markNotificationsAsRead = markNotificationsAsRead;
window.renderNotificationsPage = renderNotificationsPage;
window.getUserNotifications = getUserNotifications;
window.addUserWelcomeNotification = addUserWelcomeNotification;
window.updateNotificationsUI = updateNotificationsUI;
window.saveCustomerName = saveCustomerName;
window.getCustomerSession = getCustomerSession;
window.logoutCustomer = logoutCustomer;

// ━━ LOGOUT CONFIRMATION MODAL CONTROLLER ━━
export function openLogoutModal() {
  const modal = document.getElementById('logoutConfirmModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Add entrance animation
    const card = modal.querySelector('.logout-confirm-card');
    if (card) {
      card.style.animation = 'none';
      card.offsetHeight; // force reflow
      card.style.animation = '';
    }
  }
}

export function closeLogoutModal() {
  const modal = document.getElementById('logoutConfirmModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

export function confirmLogout() {
  closeLogoutModal();
  logoutCustomer();
}

window.openLogoutModal = openLogoutModal;
window.closeLogoutModal = closeLogoutModal;
window.confirmLogout = confirmLogout;
window.openUserOrdersModal = openUserOrdersModal;
window.closeUserOrdersModal = closeUserOrdersModal;
window.getUserOrders = getUserOrders;
window.formatOrderCardHtml = formatOrderCardHtml;
window.syncUserOrdersWithFirebase = syncUserOrdersWithFirebase;
window.addOrderConfirmedNotification = addOrderConfirmedNotification;
window.checkAndResumePendingCheckout = checkAndResumePendingCheckout;
window.renderAccountOrders = renderAccountOrders;
window.showAppToast = showAppToast;
window.formatRelativeTime = formatRelativeTime;
window.handleNotificationCardClick = handleNotificationCardClick;
window.openNotificationDetailModal = openNotificationDetailModal;
window.showSettingsPage = showProfilePage;
window.hideSettingsPage = hideProfilePage;
window.showProfilePage = showProfilePage;
window.hideProfilePage = hideProfilePage;
window.copyNotifVipLink = copyNotifVipLink;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initAuthModalEvents();
    updateNotificationsUI();
    syncUserOrdersWithFirebase().catch(() => {});
  });
} else {
  initAuthModalEvents();
  updateNotificationsUI();
  syncUserOrdersWithFirebase().catch(() => {});
}

// Background auto-sync for order approval every 8 seconds (fast response)
if (typeof window !== 'undefined') {
  setInterval(() => {
    syncUserOrdersWithFirebase().catch(() => {});
  }, 8000);

  window.addEventListener('focus', () => {
    syncUserOrdersWithFirebase().catch(() => {});
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        syncUserOrdersWithFirebase().catch(() => {});
      }
    });
  }
}

// Window resize listener to sync header visibility between desktop & mobile states
window.addEventListener('resize', () => {
  const accountView = document.getElementById('appAccountView');
  const notifsView = document.getElementById('appNotificationsView');
  const searchView = document.getElementById('appSearchView');
  const fkHeader = document.getElementById('fkHeader');
  const fkHeaderSpacer = document.getElementById('fkHeaderSpacer');
  const floatingCart = document.getElementById('leftFloatingCart');
  const isScreenActive = (accountView && accountView.style.display === 'block') ||
                         (notifsView && notifsView.style.display === 'block') ||
                         (searchView && searchView.style.display === 'block');
  if (isScreenActive && fkHeader) {
    const isDesktop = window.innerWidth > 991;
    fkHeader.style.display = isDesktop ? '' : 'none';
    if (fkHeaderSpacer) fkHeaderSpacer.style.display = isDesktop ? '' : 'none';
    if (floatingCart) floatingCart.style.display = isDesktop ? '' : 'none';
  }
}, { passive: true });





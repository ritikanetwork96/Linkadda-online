import {
  auth,
  db,
  ref,
  set,
  get,
  update,
  onValue,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from './firebase.js';
import { APP_CONFIG } from './config.js';
import { escapeHtml } from './utils.js';

if (typeof window !== 'undefined' && window.location.pathname.endsWith('.js')) {
  window.location.replace('/admin');
}

// ⚡ Auto-route local Live Server requests (any port on localhost/127.0.0.1, file: protocol) to live Render backend
if (typeof window !== 'undefined') {
  const isLocalDev = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1' ||
                     window.location.protocol === 'file:' ||
                     (window.location.port && window.location.port !== '80' && window.location.port !== '443');
  if (isLocalDev) {
    const _realFetch = window.fetch;
    window.fetch = function(url, options) {
      if (typeof url === 'string' && url.startsWith('/api/')) {
        return _realFetch('https://linkadda-online.onrender.com' + url, options);
      }
      return _realFetch(url, options);
    };
  }
}

export function getDeviceDetails() {
  const ua = navigator.userAgent || '';
  let browser = 'Browser';
  if (ua.includes('Edg/')) browser = 'Microsoft Edge';
  else if (ua.includes('Chrome/')) browser = 'Google Chrome';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Apple Safari';
  else if (ua.includes('Firefox/')) browser = 'Mozilla Firefox';
  else if (ua.includes('OPR/') || ua.includes('Opera/')) browser = 'Opera';

  let os = 'Unknown OS';
  if (ua.includes('Windows NT 10.0') || ua.includes('Windows NT 11.0')) os = 'Windows 10/11';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('iPhone')) os = 'iOS (iPhone)';
  else if (ua.includes('iPad')) os = 'iPadOS (iPad)';
  else if (ua.includes('Mac OS X')) os = 'macOS (Apple)';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';

  let type = 'Desktop';
  if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    type = 'Mobile';
  } else if (/iPad|Tablet/i.test(ua)) {
    type = 'Tablet';
  }

  return { browser, os, type };
}

let cachedGeo = null;
export async function getClientLocation() {
  if (cachedGeo) return cachedGeo;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.ip) {
        cachedGeo = {
          ip: data.ip || '',
          city: data.city || '',
          region: data.region || '',
          country: data.country_name || data.country || 'India',
          countryCode: (data.country_code || 'IN').toUpperCase(),
          isp: data.org || '',
          locationStr: [data.city, data.region, data.country_name].filter(Boolean).join(', ') || 'India',
        };
        return cachedGeo;
      }
    }
  } catch (_) {}

  try {
    const res2 = await fetch('https://ipwho.is/');
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2 && data2.success !== false && data2.ip) {
        cachedGeo = {
          ip: data2.ip || '',
          city: data2.city || '',
          region: data2.region || '',
          country: data2.country || 'India',
          countryCode: (data2.country_code || 'IN').toUpperCase(),
          isp: data2.connection?.isp || data2.connection?.org || '',
          locationStr: [data2.city, data2.region, data2.country].filter(Boolean).join(', ') || 'India',
        };
        return cachedGeo;
      }
    }
  } catch (_) {}

  return {
    ip: '',
    city: '',
    region: '',
    country: 'India',
    countryCode: 'IN',
    isp: '',
    locationStr: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  };
}

export function getCurrentSessionId() {
  let sessId = localStorage.getItem('linkadda_admin_session_id');
  if (!sessId) {
    sessId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('linkadda_admin_session_id', sessId);
  }
  return sessId;
}

export async function registerAdminSession(user) {
  if (!user) return null;
  const sessId = getCurrentSessionId();
  const device = getDeviceDetails();
  const sessionRef = ref(db, `admin_sessions/${sessId}`);

  // Persist token in localStorage for authenticated API requests
  try {
    let token = '';
    if (typeof user.getIdToken === 'function') {
      token = await user.getIdToken().catch(() => '');
    }
    if (!token && user.token) {
      token = user.token;
    }
    if (token) {
      localStorage.setItem('linkadda_admin_token', token);
      const existing = localStorage.getItem('linkadda_admin_session');
      let sessObj = {};
      try { sessObj = existing ? JSON.parse(existing) : {}; } catch (_) {}
      sessObj.token = token;
      sessObj.uid = user.uid;
      sessObj.email = user.email || 'botforword@gmail.com';
      sessObj.loginAt = sessObj.loginAt || Date.now();
      localStorage.setItem('linkadda_admin_session', JSON.stringify(sessObj));
    }
  } catch (_) {}
  
  const initialSessionData = {
    id: sessId,
    uid: user.uid,
    email: user.email || 'botforword@gmail.com',
    browser: device.browser,
    os: device.os,
    deviceType: device.type,
    ip: '',
    city: '',
    region: '',
    country: 'India',
    countryCode: 'IN',
    isp: '',
    locationStr: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    loginAt: Date.now(),
    lastActiveAt: Date.now(),
    status: 'active',
  };

  try {
    await set(sessionRef, initialSessionData);
  } catch (err) {
    console.warn('Could not register initial admin session in RTDB:', err);
  }

  // Background lookup to enrich session with real IP and City/State/Country
  getClientLocation().then((geo) => {
    if (geo && (geo.city || geo.ip || geo.locationStr)) {
      try {
        update(sessionRef, {
          ip: geo.ip || '',
          city: geo.city || '',
          region: geo.region || '',
          country: geo.country || 'India',
          countryCode: geo.countryCode || 'IN',
          isp: geo.isp || '',
          locationStr: geo.locationStr || 'India',
        });
      } catch (_) {}
    }
  }).catch(() => {});

  return sessId;
}

export function startSessionWatch(user, onTerminated) {
  if (!user) return;
  const sessId = getCurrentSessionId();
  const sessionRef = ref(db, `admin_sessions/${sessId}`);

  // Heartbeat every 45 seconds to keep lastActiveAt fresh
  const heartbeatTimer = setInterval(() => {
    try {
      update(sessionRef, { lastActiveAt: Date.now() });
    } catch (_) {}
  }, 45000);

  // Listen for remote termination from other devices
  onValue(sessionRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.status === 'terminated') {
      clearInterval(heartbeatTimer);
      if (typeof onTerminated === 'function') {
        onTerminated();
      } else {
        alert('Your admin session was signed out from another device.');
        logout();
      }
    }
  });
}

export function listenToAdminSessions(callback) {
  const currentSessId = getCurrentSessionId();
  const sessionsRef = ref(db, 'admin_sessions');
  return onValue(sessionsRef, (snapshot) => {
    const val = snapshot.val() || {};
    const list = Object.values(val)
      .filter((s) => s && typeof s === 'object' && s.id)
      .map((s) => ({
        ...s,
        isCurrent: s.id === currentSessId,
      }))
      .sort((a, b) => (b.lastActiveAt || b.loginAt || 0) - (a.lastActiveAt || a.loginAt || 0));

    if (typeof callback === 'function') {
      callback(list, currentSessId);
    }
  }, (err) => {
    console.warn('Realtime admin_sessions listen error:', err);
  });
}

export async function getActiveAdminSessions() {
  const currentSessId = getCurrentSessionId();
  const device = getDeviceDetails();
  
  const currentSessionFallback = {
    id: currentSessId,
    browser: device.browser,
    os: device.os,
    deviceType: device.type,
    locationStr: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    loginAt: Date.now(),
    lastActiveAt: Date.now(),
    status: 'active',
    isCurrent: true,
  };

  try {
    const sessionsRef = ref(db, 'admin_sessions');
    const snapshot = await get(sessionsRef);
    const val = snapshot.val() || {};
    
    let list = Object.values(val)
      .filter((s) => s && typeof s === 'object' && s.id)
      .map((s) => ({
        ...s,
        isCurrent: s.id === currentSessId,
      }))
      .sort((a, b) => (b.lastActiveAt || b.loginAt || 0) - (a.lastActiveAt || a.loginAt || 0));

    const hasCurrent = list.some((s) => s.id === currentSessId);
    if (!hasCurrent) {
      list.unshift(currentSessionFallback);
    }

    return list;
  } catch (err) {
    console.warn('Failed to get active sessions from RTDB, returning local device:', err);
    return [currentSessionFallback];
  }
}

export async function terminateAdminSession(sessionId) {
  if (!sessionId) return;
  try {
    const sessionRef = ref(db, `admin_sessions/${sessionId}`);
    await update(sessionRef, { status: 'terminated', terminatedAt: Date.now() });
  } catch (err) {
    console.error('Failed to terminate session:', err);
    throw err;
  }
}

export async function terminateAllOtherAdminSessions() {
  const currentSessId = getCurrentSessionId();
  try {
    const sessionsRef = ref(db, 'admin_sessions');
    const snapshot = await get(sessionsRef);
    const val = snapshot.val() || {};
    const updates = {};
    for (const [id, sess] of Object.entries(val)) {
      if (id !== currentSessId && sess && sess.status === 'active') {
        updates[`admin_sessions/${id}/status`] = 'terminated';
        updates[`admin_sessions/${id}/terminatedAt`] = Date.now();
      }
    }
    if (Object.keys(updates).length) {
      await update(ref(db), updates);
    }
  } catch (err) {
    console.error('Failed to terminate other sessions:', err);
    throw err;
  }
}

export function mountLoginPage(root) {
  if (!root) return;
  try {
    localStorage.removeItem('linkadda_remember_admin_email');
  } catch (_) {}
  root.innerHTML = `
    <div class="auth-shell">
      <div class="auth-card glass">
        <div class="auth-brand">
          <div class="auth-mark">L</div>
          <div>
            <h1>${escapeHtml(APP_CONFIG.appName)}</h1>
            <p>Master Administrator Access</p>
          </div>
        </div>
        <form id="loginForm" class="auth-form">
          <label>
            <span>Admin Email</span>
            <input type="email" id="adminEmail" value="" placeholder="Enter admin email" autocomplete="username" required />
          </label>
          <label>
            <span>Admin Password</span>
            <div style="position: relative; display: flex; align-items: center;">
              <input type="password" id="adminPassword" placeholder="Enter confidential password" autocomplete="current-password" required style="width: 100%; padding-right: 42px;" />
              <button type="button" id="toggleAdminPass" aria-label="Toggle password visibility" style="position: absolute; right: 10px; background: none; border: none; color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px;">
                <i data-lucide="eye" style="width: 18px; height: 18px;"></i>
              </button>
            </div>
          </label>
          <button type="submit" class="btn btn-primary btn-block" style="font-weight: 700;">Sign In as Administrator</button>
          <button type="button" id="forgotBtn" class="btn btn-ghost btn-block">Forgot Password</button>
          <p class="auth-note" id="authNote">Authorized personnel only &bull; LinkAdda Root Control</p>


        </form>
      </div>
    </div>
  `;

  const form = root.querySelector('#loginForm');
  const forgotBtn = root.querySelector('#forgotBtn');
  const note = root.querySelector('#authNote');
  const togglePassBtn = root.querySelector('#toggleAdminPass');
  const passInput = root.querySelector('#adminPassword');

  togglePassBtn?.addEventListener('click', () => {
    if (passInput) {
      const isPass = passInput.type === 'password';
      passInput.type = isPass ? 'text' : 'password';
      togglePassBtn.innerHTML = isPass
        ? '<i data-lucide="eye-off" style="width: 18px; height: 18px;"></i>'
        : '<i data-lucide="eye" style="width: 18px; height: 18px;"></i>';
      if (window.lucide) lucide.createIcons();
    }
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = root.querySelector('#adminEmail').value.trim();
    const password = root.querySelector('#adminPassword').value;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying root admin credentials...';
    }
    note.textContent = 'Authenticating admin credentials...';
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const userEmail = String(userCredential.user?.email || '').trim().toLowerCase();
      if (userEmail !== 'botforword@gmail.com') {
        await signOut(auth);
        throw new Error('Access Denied: Only root administrator (botforword@gmail.com) is authorized.');
      }
      registerAdminSession(userCredential.user).catch(() => {});
      note.textContent = 'Success! Opening admin center...';
      window.location.replace('/admin/');
    } catch (error) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In as Administrator';
      }
      note.textContent = error?.message || 'Login failed';
    }
  });

  forgotBtn?.addEventListener('click', async () => {
    const email = root.querySelector('#adminEmail').value.trim();
    if (!email) {
      note.textContent = 'Enter your email first.';
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      note.textContent = 'Password reset email sent.';
    } catch (error) {
      note.textContent = error?.message || 'Unable to send reset email';
    }
  });
}

export function protectRoute(onReady) {
  let hasHandledAuth = false;

  const unlockAdminUI = (userObj) => {
    if (hasHandledAuth) return;
    hasHandledAuth = true;
    const gate = document.getElementById('authGate');
    if (gate) {
      gate.style.display = 'none';
      try { gate.remove(); } catch (_) {}
    }
    const shell = document.getElementById('adminShell');
    if (shell) {
      shell.style.removeProperty('display');
      shell.style.display = 'flex';
    }
    const mobileNav = document.getElementById('mobileBottomNav');
    if (mobileNav) {
      mobileNav.style.removeProperty('display');
    }
    if (typeof onReady === 'function') {
      try { onReady(userObj); } catch (err) { console.error('onReady error:', err); }
    }
  };

  // ⚡ 1. Fast-Path: If valid admin session exists synchronously, unlock immediately (0ms refresh)
  if (auth && auth.currentUser) {
    const email = String(auth.currentUser.email || '').trim().toLowerCase();
    if (email === 'botforword@gmail.com') {
      registerAdminSession(auth.currentUser).catch(() => {});
      startSessionWatch(auth.currentUser);
      unlockAdminUI(auth.currentUser);
    }
  }

  // ⚡ 2. Reactive Auth State Listener
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (window.location.protocol === 'file:') {
        unlockAdminUI(auth.currentUser || { uid: 'local-admin', email: 'botforword@gmail.com', displayName: 'Linkadda Admin' });
        return;
      }
      // If admin session exists in storage, preserve login on page refresh!
      const raw = localStorage.getItem('linkadda_admin_session') || localStorage.getItem('linkadda_admin_token') || sessionStorage.getItem('linkadda_admin_session');
      if (raw) {
        unlockAdminUI(auth.currentUser || { uid: 'admin_user', email: 'botforword@gmail.com' });
        return;
      }
      const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const loginUrl = isDev ? '/admin/login.html' : '/admin/login';
      if (!/\/login(?:\.html|\/)?$/i.test(window.location.pathname)) {
        window.location.replace(loginUrl);
      }
      return;
    }

    // STRICT ROOT ACCESS ENFORCEMENT: ONLY botforword@gmail.com
    const email = String(user.email || '').trim().toLowerCase();
    if (email !== 'botforword@gmail.com') {
      try { await signOut(auth); } catch (_) {}
      const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      window.location.replace(isDev ? '/admin/login.html' : '/admin/login');
      return;
    }

    registerAdminSession(user).catch(() => {});
    startSessionWatch(user);
    unlockAdminUI(user);
  });

  // ⚡ 3. Watchdog Failsafe: Under zero circumstances can the screen stay stuck on authGate!
  setTimeout(() => {
    if (!hasHandledAuth) {
      const raw = localStorage.getItem('linkadda_admin_session') || localStorage.getItem('linkadda_admin_token') || sessionStorage.getItem('linkadda_admin_session');
      if (raw) {
        unlockAdminUI(auth.currentUser || { uid: 'admin_user', email: 'botforword@gmail.com' });
      } else {
        const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const loginUrl = isDev ? '/admin/login.html' : '/admin/login';
        if (!/\/login(?:\.html|\/)?$/i.test(window.location.pathname)) {
          window.location.replace(loginUrl);
        }
      }
    }
  }, 2500);
}

export async function logout() {
  const currentSessId = localStorage.getItem('linkadda_admin_session_id');
  if (currentSessId) {
    try {
      await terminateAdminSession(currentSessId);
    } catch (_) {}
    localStorage.removeItem('linkadda_admin_session_id');
  }
  try {
    localStorage.removeItem('linkadda_remember_admin_email');
  } catch (_) {}
  await signOut(auth);
  window.location.href = '/admin/login';
}

export function whenAuthenticated(callback) {
  onAuthStateChanged(auth, (user) => {
    if (typeof callback === 'function') callback(user);
  });
}

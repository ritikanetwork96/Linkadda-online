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
  
  const sessionData = {
    id: sessId,
    uid: user.uid,
    email: user.email || 'Admin',
    browser: device.browser,
    os: device.os,
    deviceType: device.type,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    loginAt: Date.now(),
    lastActiveAt: Date.now(),
    status: 'active',
  };

  try {
    await set(sessionRef, sessionData);
  } catch (err) {
    console.warn('Could not register admin session in RTDB:', err);
  }
  return sessId;
}

export function startSessionWatch(user, onTerminated) {
  if (!user) return;
  const sessId = getCurrentSessionId();
  const sessionRef = ref(db, `admin_sessions/${sessId}`);

  // Heartbeat every 60 seconds
  const heartbeatTimer = setInterval(() => {
    try {
      update(sessionRef, { lastActiveAt: Date.now() });
    } catch (_) {}
  }, 60000);

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

export async function getActiveAdminSessions() {
  const currentSessId = getCurrentSessionId();
  const device = getDeviceDetails();
  
  const currentSessionFallback = {
    id: currentSessId,
    browser: device.browser,
    os: device.os,
    deviceType: device.type,
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
      .filter((s) => s && s.status === 'active')
      .map((s) => ({
        ...s,
        isCurrent: s.id === currentSessId,
      }))
      .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));

    const hasCurrent = list.some((s) => s.id === currentSessId);
    if (!hasCurrent) {
      list.unshift(currentSessionFallback);
      try {
        set(ref(db, `admin_sessions/${currentSessId}`), {
          ...currentSessionFallback,
          uid: auth.currentUser?.uid || 'admin',
          email: auth.currentUser?.email || 'admin',
        }).catch(() => {});
      } catch (_) {}
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
      await registerAdminSession(userCredential.user);
      note.textContent = 'Success! Opening admin center...';
      window.location.href = '/admin';
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
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (window.location.protocol === 'file:') {
        if (!hasHandledAuth) {
          hasHandledAuth = true;
          const gate = document.getElementById('authGate');
          if (gate) gate.remove();
          const shell = document.getElementById('adminShell');
          if (shell) shell.style.removeProperty('display');
          const mobileNav = document.getElementById('mobileBottomNav');
          if (mobileNav) mobileNav.style.removeProperty('display');
          if (auth.currentUser) {
            if (typeof onReady === 'function') onReady(auth.currentUser);
          } else {
            if (typeof onReady === 'function') onReady({ uid: 'local-admin', email: 'botforword@gmail.com', displayName: 'Linkadda Admin' });
          }
        }
        return;
      }
      if (!/\/login(?:\.html)?\/?$/i.test(window.location.pathname)) {
        window.location.replace('/admin/login');
      }
      return;
    }

    // STRICT ROOT ACCESS ENFORCEMENT: ONLY botforword@gmail.com
    const email = String(user.email || '').trim().toLowerCase();
    if (email !== 'botforword@gmail.com') {
      try { await signOut(auth); } catch (_) {}
      window.location.replace('/admin/login');
      return;
    }

    if (!hasHandledAuth) {
      hasHandledAuth = true;
      registerAdminSession(user).catch(() => {});
      startSessionWatch(user);
      // Reveal the admin shell now that access is strictly verified
      const gate = document.getElementById('authGate');
      if (gate) gate.remove();
      const shell = document.getElementById('adminShell');
      if (shell) shell.style.removeProperty('display');
      const mobileNav = document.getElementById('mobileBottomNav');
      if (mobileNav) mobileNav.style.removeProperty('display');
      if (typeof onReady === 'function') onReady(user);
    }
  });
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

import crypto from 'node:crypto';
import dns from 'node:dns';

if (dns.setDefaultResultOrder) {
  try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}
}

/**
 * Shared Backend Utilities for LinkAdda Serverless APIs
 */

/**
 * Retrieves the cryptographic secret for HMAC signing & token validation.
 */
/**
 * Retrieves the cryptographic secret for HMAC signing & token validation.
 * Falls back to an in-memory random secret if env vars are unset.
 */
export function getAuthSecret() {
  const secret = (process.env.AUTH_SECRET || '').trim();
  if (secret) return secret;
  if (!globalThis.__SECURE_RUN_SECRET) {
    globalThis.__SECURE_RUN_SECRET = crypto.randomBytes(32).toString('hex');
  }
  return globalThis.__SECURE_RUN_SECRET;
}

/**
 * Validates whether an email string is well-formed.
 */
export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Extracts the client IP address from request headers or socket.
 */
export function getClientIp(req) {
  const headers = req?.headers || {};
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers['x-real-ip'] || req?.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Configures CORS headers and handles preflight OPTIONS requests with origin whitelisting.
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response
 * @param {string} methods - Allowed HTTP methods (e.g. 'POST, OPTIONS')
 * @returns {boolean} - Returns true if request was an OPTIONS preflight and handled.
 */
export function handleCors(req, res, methods = 'GET, POST, OPTIONS') {
  const origin = req.headers?.origin || '';
  const isAllowed = !origin ||
    origin === 'https://linkadda.online' ||
    origin.endsWith('.linkadda.online') ||
    origin === 'https://linkadda.shop' ||
    origin.endsWith('.linkadda.shop') ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin.includes('vercel.app');

  const allowOrigin = isAllowed ? (origin || 'https://linkadda.online') : 'https://linkadda.online';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-folder, x-filename, x-action');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') {
      res.status(200).end();
    } else {
      res.statusCode = 200;
      res.end();
    }
    return true;
  }
  return false;
}

/**
 * Generates a deterministic customer UID from an email address: cust_<sha256(16)>
 */
export function deriveCustomerId(email) {
  const clean = String(email || '').toLowerCase().trim();
  const hash = crypto.createHash('sha256').update(clean).digest('hex').substring(0, 16);
  return `cust_${hash}`;
}

/**
 * Generates a title-cased fallback display name from an email address (e.g. 'john.doe@...' -> 'John Doe')
 */
export function getFallbackDisplayName(email) {
  if (!email || typeof email !== 'string') return 'Valued Member';
  const prefix = email.split('@')[0] || '';
  return prefix
    .replace(/[._\-+]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || 'Valued Member';
}

export const formatFallbackName = getFallbackDisplayName;

let cachedAdminToken = null;
let adminTokenExpiresAt = 0;

export async function getFirebaseAdminToken() {
  if (cachedAdminToken && Date.now() < adminTokenExpiresAt - 60000) {
    return cachedAdminToken;
  }
  const apiKey = (process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '').trim();
  const adminEmail = (process.env.admin || process.env.ADMIN_EMAIL || process.env.ADMIN || 'botforword@gmail.com').trim();
  const adminPassword = (process.env.password || process.env.ADMIN_PASSWORD || process.env.PASSWORD || '').trim();

  if (!apiKey || !adminEmail || !adminPassword) {
    return null;
  }

  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword, returnSecureToken: true }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.idToken) {
      cachedAdminToken = data.idToken;
      adminTokenExpiresAt = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
      return cachedAdminToken;
    }
  } catch (err) {
    console.warn('Firebase admin token error:', err.message);
  }
  return null;
}

/**
 * Validates whether an incoming HTTP request is authenticated as Master Admin.
 * Verifies Bearer Firebase ID Token against Google Identity Toolkit, or against master AUTH_SECRET.
 */
export async function verifyAdminRequest(req) {
  const authHeader = req?.headers?.authorization || req?.headers?.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  // 1. Direct secret match if called server-to-server (strictly dedicated AUTH_SECRET only)
  const dedicatedAuthSecret = (process.env.AUTH_SECRET || '').trim();
  if (dedicatedAuthSecret && token === dedicatedAuthSecret) return true;

  // 2. Direct password match if passed as bearer
  const adminPassword = (process.env.password || process.env.ADMIN_PASSWORD || process.env.PASSWORD || '').trim();
  if (adminPassword && token === adminPassword) return true;

  // 3. Verify Firebase ID Token via Google Identity Toolkit
  const apiKey = (process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '').trim();
  if (apiKey) {
    try {
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      });
      if (res.ok) {
        const data = await res.json();
        const email = data?.users?.[0]?.email?.toLowerCase()?.trim();
        const targetAdminEmail = (process.env.admin || process.env.ADMIN_EMAIL || process.env.ADMIN || 'botforword@gmail.com').toLowerCase().trim();
        if (email && (email === targetAdminEmail || email === 'botforword@gmail.com')) {
          return true;
        }
      }
    } catch (e) {
      console.warn('verifyAdminRequest identity error:', e.message);
    }
  }

  return false;
}


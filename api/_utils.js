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

/**
 * Validates whether an incoming HTTP request is authenticated as Master Admin.
 * Verifies Bearer HMAC session token, dedicated AUTH_SECRET, or admin password.
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

  // 3. HMAC-signed Admin session token (timestamp.signature)
  if (token.includes('.')) {
    try {
      const [expiresStr, sig] = token.split('.');
      const expiresAt = Number(expiresStr);
      if (expiresAt && Date.now() < expiresAt) {
        const targetEmail = (process.env.admin || process.env.ADMIN_EMAIL || process.env.ADMIN || 'botforword@gmail.com').trim().toLowerCase();
        const secret = getAuthSecret();
        const expectedSig = crypto.createHmac('sha256', secret).update(`${targetEmail}:${expiresAt}`).digest('hex');
        const bufA = Buffer.from(sig);
        const bufB = Buffer.from(expectedSig);
        if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
          return true;
        }
      }
    } catch (_) {}
  }

  return false;
}


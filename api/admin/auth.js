import crypto from 'node:crypto';
import { handleCors, getAuthSecret, getClientIp } from '../_utils.js';

/**
 * Timing-safe string comparison to prevent timing attacks on passwords
 */
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    let body = req.body;
    if (!body && typeof req.on === 'function') {
      body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (_) { resolve({}); }
        });
        req.on('error', () => resolve({}));
      });
    } else if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '').trim();

    const targetEmail = (process.env.admin || process.env.ADMIN_EMAIL || process.env.ADMIN || 'botforword@gmail.com').trim().toLowerCase();
    const targetPassword = (process.env.password || process.env.ADMIN_PASSWORD || process.env.PASSWORD || '').trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const emailMatches = timingSafeEqualStr(email, targetEmail);
    const passwordMatches = targetPassword && timingSafeEqualStr(password, targetPassword);

    if (!emailMatches || !passwordMatches) {
      // Log security warning
      console.warn(`[SECURITY] Failed admin login attempt from IP ${getClientIp(req)} for email: ${email}`);
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    // Generate high-entropy HMAC signed session token (valid for 7 days)
    const secret = getAuthSecret();
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const payload = `${email}:${expiresAt}`;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const token = `${expiresAt}.${signature}`;

    return res.status(200).json({
      success: true,
      admin: email,
      token,
      expiresAt,
    });
  } catch (err) {
    console.error('Admin auth handler error:', err);
    return res.status(500).json({ error: 'Authentication service error.' });
  }
}

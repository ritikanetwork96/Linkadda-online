import crypto from 'node:crypto';
import { handleCors, getAuthSecret, isValidEmail, getFirebaseAdminToken, SELLER_MEMORY_STORE } from '../_utils.js';

const RTDB_URL = 'https://linkadda-online-default-rtdb.firebaseio.com';

const sellerFailedLoginMap = globalThis.__SELLER_FAILED_LOGINS || (globalThis.__SELLER_FAILED_LOGINS = new Map());
const MAX_SELLER_LOGIN_ATTEMPTS = 5;
const SELLER_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function hashSellerPassword(password, secret) {
  return crypto.createHmac('sha256', secret).update(password).digest('hex');
}

export function createSellerToken(sellerId, secret) {
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days session
  const payload = `${sellerId}:${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${expires}.${sig}`;
}

export function verifySellerToken(sellerId, token, secret) {
  if (!token || !token.includes('.')) return false;
  const [expiresStr, sig] = token.split('.');
  const expires = Number(expiresStr);
  if (isNaN(expires) || Date.now() > expires) return false;
  const expectedSig = crypto.createHmac('sha256', secret).update(`${sellerId}:${expires}`).digest('hex');
  const bufSig = Buffer.from(sig, 'hex');
  const bufExpected = Buffer.from(expectedSig, 'hex');
  return bufSig.length === bufExpected.length && crypto.timingSafeEqual(bufSig, bufExpected);
}

function renderPasswordResetEmail(ownerName, storeName, otpCode) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your LinkAdda Partner Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07060c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060c; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background: #120e1f; border-radius: 20px; border: 1px solid rgba(255, 42, 141, 0.25); box-shadow: 0 20px 50px rgba(0,0,0,0.7); overflow: hidden;">
          <tr>
            <td style="padding: 32px 28px 20px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <div style="font-size: 24px; font-weight: 800; color: #ffffff;">
                LinkAdda <span style="color: #ff2a8d;">&#9819;</span> <span style="color: #ff2a8d;">Seller Hub</span>
              </div>
              <div style="margin-top: 4px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #fbbf24; font-weight: 700;">
                Password Reset Verification
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 28px; text-align: center;">
              <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 800; color: #ffffff;">Hello ${ownerName || storeName}!</h2>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                We received a request to reset the password for your LinkAdda seller account (<strong>${storeName}</strong>). Use the verification code below to set your new password:
              </p>
              <div style="margin: 0 auto 24px; display: inline-block; padding: 14px 28px; background: rgba(255, 42, 141, 0.12); border: 2px dashed #ff2a8d; border-radius: 12px; letter-spacing: 6px; font-size: 32px; font-weight: 900; color: #ffffff; font-family: monospace;">
                ${otpCode}
              </div>
              <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                This code is valid for <strong>15 minutes</strong>. If you did not request this password reset, please ignore this email or contact LinkAdda support.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 28px; background: rgba(255, 255, 255, 0.02); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                &copy; ${new Date().getFullYear()} LinkAdda Online &bull; Seller Partner Security
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function renderPasswordChangedNotificationEmail(ownerName, storeName, timestampStr, portalUrl) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your LinkAdda Seller Password Has Been Updated</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07060c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060c; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background: #120e1f; border-radius: 20px; border: 1px solid rgba(16, 185, 129, 0.3); box-shadow: 0 20px 50px rgba(0,0,0,0.7); overflow: hidden;">
          <tr>
            <td style="padding: 32px 28px 20px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <div style="font-size: 24px; font-weight: 800; color: #ffffff;">
                LinkAdda <span style="color: #10b981;">&#9819;</span> <span style="color: #10b981;">Seller Hub</span>
              </div>
              <div style="margin-top: 4px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #10b981; font-weight: 700;">
                Security Notification
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 28px; text-align: center;">
              <div style="display: inline-block; width: 64px; height: 64px; line-height: 64px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981; font-size: 28px; margin-bottom: 18px;">
                &#9989;
              </div>
              <h2 style="margin: 0 0 12px; font-size: 22px; font-weight: 800; color: #ffffff;">Password Changed Successfully</h2>
              <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                Hello <strong>${ownerName || storeName}</strong>, this is an official security confirmation that the confidential password for your LinkAdda seller account (<strong>${storeName}</strong>) was successfully updated on <strong>${timestampStr}</strong>.
              </p>

              <div style="margin: 0 auto 26px; padding: 16px 20px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; text-align: left;">
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">&#128274; Account Status: <span style="color: #10b981; font-weight: 600;">Secured & Active</span></div>
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">&#128337; Updated At: <span style="color: #ffffff;">${timestampStr}</span></div>
                <div style="font-size: 12px; color: #94a3b8;">&#127978; Store: <span style="color: #ffffff;">${storeName}</span></div>
              </div>

              <a href="${portalUrl}" style="display: inline-block; padding: 14px 34px; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; text-decoration: none; font-weight: 800; font-size: 15px; border-radius: 12px; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.35);">
                Open Seller Hub &rarr;
              </a>

              <p style="margin: 26px 0 0; font-size: 12px; line-height: 1.5; color: #64748b;">
                If you made this change, you can safely disregard this message. If you did <strong>NOT</strong> authorize this change, please immediately reach out to our Helpdesk at <strong>ritikanetwork96@gmail.com</strong> or contact Telegram <strong>@TRUSTED_BROTHER1234</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 28px; background: rgba(255, 255, 255, 0.02); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                &copy; ${new Date().getFullYear()} LinkAdda Online &bull; Seller Partner Security
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = String(body.action || 'login').trim().toLowerCase();
    const secret = getAuthSecret();
    const adminToken = await getFirebaseAdminToken();
    const authQuery = adminToken ? `?auth=${encodeURIComponent(adminToken)}` : '';

    // Helper to find a seller by email
    async function findSellerByEmail(email) {
      const cleanEmail = String(email || '').trim().toLowerCase();

      // 1. Query RTDB events first so we always have the freshest record!
      try {
        const evRes = await fetch(`${RTDB_URL}/events/sellers.json${authQuery}`);
        if (evRes.ok) {
          const sellers = await evRes.json();
          if (sellers && typeof sellers === 'object') {
            for (const [key, s] of Object.entries(sellers)) {
              if (s && String(s.email || '').toLowerCase() === cleanEmail) {
                const found = { ...s, id: s.id || key };
                SELLER_MEMORY_STORE.sellers.set(found.id, found);
                return found;
              }
            }
          }
        }
      } catch (_) {}

      // 2. Query root sellers
      try {
        const rootRes = await fetch(`${RTDB_URL}/sellers.json${authQuery}`);
        if (rootRes.ok) {
          const sellers = await rootRes.json();
          if (sellers && typeof sellers === 'object') {
            for (const [key, s] of Object.entries(sellers)) {
              if (s && String(s.email || '').toLowerCase() === cleanEmail) {
                const found = { ...s, id: s.id || key };
                SELLER_MEMORY_STORE.sellers.set(found.id, found);
                return found;
              }
            }
          }
        }
      } catch (_) {}

      // 3. Fallback to in-memory store
      for (const s of SELLER_MEMORY_STORE.sellers.values()) {
        if (s && String(s.email || '').toLowerCase() === cleanEmail) {
          return { ...s };
        }
      }

      return null;
    }

    // ━━ 1. SELLER LOGIN ━━
    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '').trim();

      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      if (!password) {
        return res.status(400).json({ error: 'Please enter your password.' });
      }

      // Check lockout status
      const now = Date.now();
      const attemptRecord = sellerFailedLoginMap.get(email) || { count: 0, lockedUntil: 0 };
      if (attemptRecord.lockedUntil && now < attemptRecord.lockedUntil) {
        const remainingMinutes = Math.ceil((attemptRecord.lockedUntil - now) / 60000);
        return res.status(429).json({
          error: `Account temporarily locked due to multiple failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
          locked: true,
          retryAfter: Math.ceil((attemptRecord.lockedUntil - now) / 1000),
        });
      }

      const matchedSeller = await findSellerByEmail(email);

      if (!matchedSeller) {
        return res.status(401).json({ error: 'No seller account found with this email. Have you applied yet?' });
      }

      if (matchedSeller.status === 'suspended') {
        return res.status(403).json({ error: 'Your seller account is currently suspended. Please contact LinkAdda Admin.' });
      }

      // Verify Password Hash
      const inputHash = hashSellerPassword(password, secret);
      const storedHash = matchedSeller.passwordHash;

      const bufInput = Buffer.from(inputHash, 'hex');
      const bufStored = Buffer.from(storedHash || '', 'hex');

      if (bufInput.length !== bufStored.length || !crypto.timingSafeEqual(bufInput, bufStored)) {
        const nextCount = attemptRecord.count + 1;
        if (nextCount >= MAX_SELLER_LOGIN_ATTEMPTS) {
          sellerFailedLoginMap.set(email, { count: nextCount, lockedUntil: now + SELLER_LOCKOUT_MS });
          return res.status(429).json({
            error: 'Too many incorrect password attempts. Your seller account has been locked for 15 minutes for your security.',
            locked: true,
            retryAfter: 900,
          });
        }
        sellerFailedLoginMap.set(email, { count: nextCount, lockedUntil: 0 });
        const remaining = Math.max(0, MAX_SELLER_LOGIN_ATTEMPTS - nextCount);
        return res.status(401).json({
          error: `Incorrect password. ${remaining} attempt(s) remaining before account lockout.`,
        });
      }

      // Clear failed login attempts counter on successful authentication
      sellerFailedLoginMap.delete(email);

      // Generate 30-day session token
      const token = createSellerToken(matchedSeller.id, secret);

      const safeSeller = {
        id: matchedSeller.id,
        email: matchedSeller.email,
        ownerName: matchedSeller.ownerName,
        storeName: matchedSeller.storeName,
        phone: matchedSeller.phone || '',
        telegram: matchedSeller.telegram || '',
        upiId: matchedSeller.upiId || '',
        category: matchedSeller.category,
        mustChangePassword: Boolean(matchedSeller.mustChangePassword),
        status: matchedSeller.status,
      };

      return res.status(200).json({
        success: true,
        seller: safeSeller,
        token,
        message: `Welcome back to LinkAdda Seller Hub, ${safeSeller.storeName}!`,
      });
    }

    // ━━ 2. CHANGE PASSWORD ━━
    if (action === 'change_password') {
      const sellerId = String(body.sellerId || '').trim();
      const token = String(body.token || '').trim();
      const oldPassword = String(body.oldPassword || '').trim();
      const newPassword = String(body.newPassword || '').trim();

      if (!sellerId || !verifySellerToken(sellerId, token, secret)) {
        return res.status(401).json({ error: 'Unauthorized session. Please log in again.' });
      }

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
      }

      let seller = SELLER_MEMORY_STORE.sellers.get(sellerId);

      if (!seller) {
        try {
          const evSRes = await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (evSRes.ok) seller = await evSRes.json();
        } catch (_) {}
      }

      if (!seller) {
        try {
          const rootSRes = await fetch(`${RTDB_URL}/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (rootSRes.ok) seller = await rootSRes.json();
        } catch (_) {}
      }

      if (!seller) return res.status(404).json({ error: 'Seller record not found.' });

      // Verify old password if provided
      if (seller.passwordHash && oldPassword) {
        const oldHash = hashSellerPassword(oldPassword, secret);
        const bufInput = Buffer.from(oldHash, 'hex');
        const bufStored = Buffer.from(seller.passwordHash, 'hex');
        if (bufInput.length !== bufStored.length || !crypto.timingSafeEqual(bufInput, bufStored)) {
          return res.status(400).json({ error: 'Current password does not match.' });
        }
      }

      const newHash = hashSellerPassword(newPassword, secret);
      const updateData = {
        passwordHash: newHash,
        mustChangePassword: false,
        passwordUpdatedAt: Date.now(),
      };

      if (SELLER_MEMORY_STORE.sellers.has(sellerId)) {
        const memSeller = SELLER_MEMORY_STORE.sellers.get(sellerId);
        memSeller.passwordHash = newHash;
        memSeller.mustChangePassword = false;
        memSeller.passwordUpdatedAt = Date.now();
      }

      try {
        await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        });

        if (adminToken) {
          fetch(`${RTDB_URL}/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData),
          }).catch(() => {});
        }
      } catch (_) {}

      // Send Security Confirmation Email via Brevo API
      const apiKey = (process.env.BREVO_API_KEY || '').trim();
      const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'ritikanetwork96@gmail.com').trim();
      const senderName = (process.env.BREVO_SENDER_NAME || 'Linkadda Online').trim();

      const reqHost = req.headers['host'] || req.headers['x-forwarded-host'] || '';
      const isLocal = reqHost.includes('localhost') || reqHost.includes('127.0.0.1');
      const portalUrl = isLocal ? `http://${reqHost}/seller/login` : 'https://linkadda.online/seller/login';

      if (apiKey && seller.email) {
        try {
          const timestampStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
          await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': apiKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              sender: { name: senderName, email: senderEmail },
              to: [{ email: seller.email, name: seller.ownerName || seller.storeName }],
              subject: `🔒 Security Alert: Your LinkAdda Seller Password Has Been Updated`,
              htmlContent: renderPasswordChangedNotificationEmail(
                seller.ownerName || seller.storeName,
                seller.storeName,
                timestampStr,
                portalUrl
              ),
            }),
          });
        } catch (mailErr) {
          console.warn('Could not send password change confirmation email:', mailErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Password updated successfully! A confirmation notification has been sent to your email.',
      });
    }

    // ━━ 3. FORGOT PASSWORD REQUEST (SEND OTP) ━━
    if (action === 'forgot_password_request') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }

      const seller = await findSellerByEmail(email);
      if (!seller) {
        return res.status(404).json({ error: 'No registered seller account found with this email. Have you applied yet?' });
      }

      const otp = crypto.randomInt(100000, 1000000).toString();
      const resetExpires = Date.now() + 15 * 60 * 1000; // 15 mins

      const updateData = {
        resetOtp: otp,
        resetExpires,
        resetAttempts: 0,
      };

      if (SELLER_MEMORY_STORE.sellers.has(seller.id)) {
        const mem = SELLER_MEMORY_STORE.sellers.get(seller.id);
        mem.resetOtp = otp;
        mem.resetExpires = resetExpires;
        mem.resetAttempts = 0;
      }

      try {
        await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(seller.id)}.json${authQuery}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        });
      } catch (e) {
        console.warn('Failed to save reset OTP:', e.message);
      }

      // Send OTP via Brevo API
      const apiKey = (process.env.BREVO_API_KEY || '').trim();
      const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'ritikanetwork96@gmail.com').trim();
      const senderName = (process.env.BREVO_SENDER_NAME || 'Linkadda Online').trim();

      if (apiKey) {
        try {
          await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': apiKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              sender: { name: senderName, email: senderEmail },
              to: [{ email: seller.email, name: seller.ownerName || seller.storeName }],
              subject: `🔐 LinkAdda Seller Hub: Your Password Reset Code is ${otp}`,
              htmlContent: renderPasswordResetEmail(seller.ownerName, seller.storeName, otp),
            }),
          });
        } catch (mailErr) {
          console.warn('Brevo reset email dispatch warning:', mailErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: `A 6-digit verification code has been dispatched to ${email}.`,
      });
    }

    // ━━ 4. FORGOT PASSWORD VERIFY (RESET PASSWORD) ━━
    if (action === 'forgot_password_verify') {
      const email = String(body.email || '').trim().toLowerCase();
      const otp = String(body.otp || '').trim();
      const newPassword = String(body.newPassword || '').trim();

      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      if (!otp || otp.length < 4) {
        return res.status(400).json({ error: 'Please enter the verification code sent to your email.' });
      }
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
      }

      const seller = await findSellerByEmail(email);
      if (!seller) {
        return res.status(404).json({ error: 'No seller record found.' });
      }

      const currentAttempts = Number(seller.resetAttempts || 0);
      if (currentAttempts >= 5) {
        // Invalidate OTP on 5 failed attempts
        try {
          await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(seller.id)}.json${authQuery}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resetOtp: null, resetExpires: null, resetAttempts: 0 }),
          });
        } catch (_) {}
        return res.status(429).json({ error: 'Too many incorrect attempts. Password reset code has been locked. Please request a new code.' });
      }

      if (!seller.resetOtp || String(seller.resetOtp).trim() !== otp) {
        const nextAttempts = currentAttempts + 1;
        try {
          await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(seller.id)}.json${authQuery}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resetAttempts: nextAttempts }),
          });
        } catch (_) {}
        const remaining = Math.max(0, 5 - nextAttempts);
        return res.status(400).json({ error: `Invalid verification code. ${remaining} attempt(s) remaining.` });
      }

      if (!seller.resetExpires || Date.now() > Number(seller.resetExpires)) {
        return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
      }

      const newHash = hashSellerPassword(newPassword, secret);
      const updateData = {
        passwordHash: newHash,
        mustChangePassword: false,
        passwordUpdatedAt: Date.now(),
        resetOtp: null,
        resetExpires: null,
        resetAttempts: 0,
      };

      if (SELLER_MEMORY_STORE.sellers.has(seller.id)) {
        const mem = SELLER_MEMORY_STORE.sellers.get(seller.id);
        mem.passwordHash = newHash;
        mem.mustChangePassword = false;
        mem.passwordUpdatedAt = Date.now();
        mem.resetOtp = null;
        mem.resetExpires = null;
        mem.resetAttempts = 0;
      }

      try {
        await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(seller.id)}.json${authQuery}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        });

        if (adminToken) {
          fetch(`${RTDB_URL}/sellers/${encodeURIComponent(seller.id)}.json${authQuery}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData),
          }).catch(() => {});
        }
      } catch (e) {
        console.warn('Failed to update reset password:', e.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Password reset successfully! You can now sign in with your new password.',
      });
    }

    // ━━ 5. GET SESSION / VALIDATE ━━
    if (action === 'get_session') {
      const sellerId = String(body.sellerId || '').trim();
      const token = String(body.token || '').trim();

      if (!sellerId || !verifySellerToken(sellerId, token, secret)) {
        return res.status(401).json({ error: 'Invalid or expired session.', valid: false });
      }

      let seller = SELLER_MEMORY_STORE.sellers.get(sellerId);

      if (!seller) {
        try {
          const evRes = await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (evRes.ok) seller = await evRes.json();
        } catch (_) {}
      }

      if (!seller) {
        try {
          const rootRes = await fetch(`${RTDB_URL}/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (rootRes.ok) seller = await rootRes.json();
        } catch (_) {}
      }

      if (!seller) return res.status(404).json({ error: 'Seller not found.', valid: false });

      return res.status(200).json({
        success: true,
        valid: true,
        seller: {
          id: seller.id || sellerId,
          email: seller.email,
          ownerName: seller.ownerName,
          storeName: seller.storeName,
          phone: seller.phone || '',
          telegram: seller.telegram || '',
          upiId: seller.upiId || '',
          category: seller.category,
          mustChangePassword: Boolean(seller.mustChangePassword),
          status: seller.status,
        },
      });
    }

    // ━━ 6. UPDATE SELLER PROFILE & SETTINGS ━━
    if (action === 'update_profile') {
      const sellerId = String(body.sellerId || '').trim();
      const token = String(body.token || '').trim();

      if (!sellerId || !verifySellerToken(sellerId, token, secret)) {
        return res.status(401).json({ error: 'Unauthorized seller session. Please log in again.' });
      }

      const storeName = String(body.storeName || '').trim();
      const ownerName = String(body.ownerName || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const phone = String(body.phone || '').trim();
      const telegram = String(body.telegram || '').trim();
      const upiId = String(body.upiId || '').trim();

      const currentPassword = String(body.currentPassword || '').trim();
      const newPassword = String(body.newPassword || '').trim();

      if (!storeName) {
        return res.status(400).json({ error: 'Company / Store Name is required.' });
      }
      if (!ownerName) {
        return res.status(400).json({ error: 'Your Full Name is required.' });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }

      // Strictly protect admin account
      if (email.toLowerCase() === 'botforword@gmail.com') {
        return res.status(403).json({ error: 'This email is reserved for system administration.' });
      }

      // Fetch existing seller
      let seller = SELLER_MEMORY_STORE.sellers.get(sellerId);
      if (!seller) {
        try {
          const evRes = await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (evRes.ok) seller = await evRes.json();
        } catch (_) {}
      }
      if (!seller) {
        try {
          const rootRes = await fetch(`${RTDB_URL}/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (rootRes.ok) seller = await rootRes.json();
        } catch (_) {}
      }

      if (!seller) {
        return res.status(404).json({ error: 'Seller account not found.' });
      }

      // If email changed, verify uniqueness across other sellers
      if (email !== String(seller.email || '').toLowerCase()) {
        const existingWithEmail = await findSellerByEmail(email);
        if (existingWithEmail && existingWithEmail.id !== sellerId) {
          return res.status(400).json({ error: 'Another seller is already registered with this email address.' });
        }
      }

      // If new password provided, verify current password
      let updatedHash = null;
      if (newPassword) {
        if (newPassword.length < 6) {
          return res.status(400).json({ error: 'New password must be at least 6 characters.' });
        }
        if (seller.passwordHash && currentPassword) {
          const oldHash = hashSellerPassword(currentPassword, secret);
          const bufInput = Buffer.from(oldHash, 'hex');
          const bufStored = Buffer.from(seller.passwordHash, 'hex');
          if (bufInput.length !== bufStored.length || !crypto.timingSafeEqual(bufInput, bufStored)) {
            return res.status(400).json({ error: 'Current password is incorrect.' });
          }
        } else if (seller.passwordHash && !currentPassword) {
          return res.status(400).json({ error: 'Please enter your current password to set a new password.' });
        }
        updatedHash = hashSellerPassword(newPassword, secret);
      }

      const patchData = {
        storeName,
        ownerName,
        email,
        phone,
        telegram,
        upiId,
        updatedAt: Date.now(),
      };

      if (updatedHash) {
        patchData.passwordHash = updatedHash;
        patchData.mustChangePassword = false;
        patchData.passwordUpdatedAt = Date.now();
      }

      // Update in-memory
      if (SELLER_MEMORY_STORE.sellers.has(sellerId)) {
        const mem = SELLER_MEMORY_STORE.sellers.get(sellerId);
        Object.assign(mem, patchData);
      }

      // Update RTDB /events/sellers/{id}
      try {
        await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchData),
        });
      } catch (e) {
        console.warn('events/sellers patch error:', e.message);
      }

      // Update RTDB /sellers/{id}
      try {
        await fetch(`${RTDB_URL}/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchData),
        });
      } catch (e) {
        console.warn('sellers patch error:', e.message);
      }

      // If storeName changed, sync all products belonging to this seller!
      if (storeName !== seller.storeName) {
        try {
          const prodRes = await fetch(`${RTDB_URL}/products.json${authQuery}`);
          if (prodRes.ok) {
            const allProds = await prodRes.json();
            if (allProds && typeof allProds === 'object') {
              const updates = {};
              for (const [pid, p] of Object.entries(allProds)) {
                if (p && p.sellerId === sellerId) {
                  updates[`products/${pid}/sellerName`] = storeName;
                }
              }
              if (Object.keys(updates).length > 0) {
                await fetch(`${RTDB_URL}/.json${authQuery}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(updates),
                });
              }
            }
          }
        } catch (prodErr) {
          console.warn('Product sellerName sync error:', prodErr.message);
        }
      }

      const updatedSafeSeller = {
        id: sellerId,
        email,
        ownerName,
        storeName,
        phone,
        telegram,
        upiId,
        category: seller.category || 'General',
        mustChangePassword: false,
        status: seller.status || 'active',
      };

      return res.status(200).json({
        success: true,
        seller: updatedSafeSeller,
        message: 'Profile and account details updated successfully in database!',
      });
    }

    return res.status(400).json({ error: 'Invalid action requested.' });
  } catch (err) {
    console.error('Unexpected error in /api/seller/auth:', err);
    return res.status(500).json({ error: err.message || 'Server error in seller authentication.' });
  }
}

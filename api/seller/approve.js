import crypto from 'node:crypto';
import { handleCors, getAuthSecret, isValidEmail, getFirebaseAdminToken, verifyAdminRequest, SELLER_MEMORY_STORE } from '../_utils.js';

const RTDB_URL = 'https://linkadda-online-default-rtdb.firebaseio.com';

function hashSellerPassword(password, secret) {
  return crypto.createHmac('sha256', secret).update(password).digest('hex');
}

function renderSellerApprovalEmail(ownerName, storeName, sellerEmail, tempPassword, portalUrl = 'https://linkadda.online/seller/login') {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your LinkAdda Seller Account is Approved</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07060c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060c; padding: 40px 15px;">
    <tr>
      <td align="center">
        <!-- Container Card -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 540px; background: linear-gradient(165deg, #181426 0%, #0d0b17 100%); border-radius: 24px; border: 1px solid rgba(255, 42, 141, 0.25); box-shadow: 0 25px 60px rgba(0,0,0,0.7), 0 0 45px rgba(255, 42, 141, 0.15); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="padding: 36px 32px 24px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.02);">
              <div style="font-size: 26px; font-weight: 800; color: #ffffff;">
                LinkAdda <span style="color: #ff2a8d; font-size: 26px;">&#9819;</span> <span style="background: linear-gradient(135deg, #ff2a8d 0%, #ff7bb0 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Seller Hub</span>
              </div>
              <div style="margin-top: 6px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #fbbf24; font-weight: 700;">
                Official Partner Onboarding
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 32px 30px; text-align: center;">
              <div style="display: inline-block; padding: 6px 18px; border-radius: 9999px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); color: #34d399; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 20px;">
                &#10004; Application Approved
              </div>

              <h1 style="margin: 0 0 14px; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px;">
                Welcome to the Family, ${ownerName}!
              </h1>
              
              <p style="margin: 0 0 28px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                Your seller application for <strong style="color: #ffffff;">${storeName}</strong> has been officially approved by LinkAdda Admin. You can now access your seller dashboard, list your exclusive packs, and track your orders.
              </p>

              <!-- Credentials Box -->
              <div style="margin: 0 auto 30px; max-width: 420px; padding: 24px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 18px; text-align: left;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; font-weight: 700; margin-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px;">
                  &#128272; Your Seller Login Credentials
                </div>
                
                <div style="margin-bottom: 12px;">
                  <span style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Login Email:</span>
                  <span style="font-size: 14px; font-weight: 700; color: #ffffff; font-family: monospace;">${sellerEmail}</span>
                </div>

                <div style="margin-bottom: 6px;">
                  <span style="display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Temporary Password:</span>
                  <span style="display: inline-block; padding: 8px 14px; background: rgba(255, 42, 141, 0.16); border: 1px dashed #ff2a8d; border-radius: 8px; font-size: 16px; font-weight: 800; color: #ffffff; font-family: monospace; letter-spacing: 1.5px;">${tempPassword}</span>
                </div>

                <div style="margin-top: 14px; font-size: 11px; color: #f59e0b; line-height: 1.5;">
                  &#9888; <strong>Security Notice:</strong> You will be prompted to set your own permanent password immediately upon your first login.
                </div>
              </div>

              <!-- CTA Button -->
              <div style="margin-bottom: 24px;">
                <a href="${portalUrl}" style="display: inline-block; background: linear-gradient(135deg, #ff2a8d 0%, #ff65a3 100%); color: #ffffff; text-decoration: none; padding: 14px 34px; border-radius: 14px; font-size: 14px; font-weight: 700; box-shadow: 0 8px 24px rgba(255, 42, 141, 0.4); text-transform: uppercase; letter-spacing: 0.5px;">
                  Login to Seller Hub &rarr;
                </a>
              </div>

              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                Direct URL: <a href="${portalUrl}" style="color: #ff2a8d; text-decoration: none;">${portalUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background: rgba(255, 255, 255, 0.02); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                &copy; ${new Date().getFullYear()} LinkAdda Online &bull; All Rights Reserved
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
    const isAuthorized = await verifyAdminRequest(req);
    if (!isAuthorized) {
      return res.status(401).json({ error: 'Unauthorized: Master administrator authentication required.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const applicationId = String(body.applicationId || '').trim();
    const action = String(body.action || 'approve').trim().toLowerCase();

    if (!applicationId) {
      return res.status(400).json({ error: 'Missing applicationId parameter.' });
    }

    const adminToken = await getFirebaseAdminToken();
    const authQuery = adminToken ? `?auth=${encodeURIComponent(adminToken)}` : '';

    // 1. Check in-memory store first
    let app = SELLER_MEMORY_STORE.applications.get(applicationId);

    // 2. If not in memory, check RTDB events then root
    if (!app || !app.email) {
      try {
        const appRes = await fetch(`${RTDB_URL}/events/seller_applications/${encodeURIComponent(applicationId)}.json${authQuery}`);
        if (appRes.ok) app = await appRes.json();
      } catch (_) {}
    }

    if (!app || !app.email) {
      try {
        const rootAppRes = await fetch(`${RTDB_URL}/seller_applications/${encodeURIComponent(applicationId)}.json${authQuery}`);
        if (rootAppRes.ok) app = await rootAppRes.json();
      } catch (_) {}
    }

    if (!app || !app.email) {
      return res.status(404).json({ error: 'Application record not found in database.' });
    }

    if (action === 'reject') {
      const rejectPayload = {
        status: 'rejected',
        reviewedAt: Date.now(),
        rejectionReason: String(body.reason || 'Did not meet store criteria.').trim(),
      };

      await fetch(`${RTDB_URL}/events/seller_applications/${encodeURIComponent(applicationId)}.json${authQuery}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rejectPayload),
      });

      if (adminToken) {
        fetch(`${RTDB_URL}/seller_applications/${encodeURIComponent(applicationId)}.json${authQuery}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rejectPayload),
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        message: `Application for ${app.storeName} has been rejected.`,
      });
    }

    // Guard against repeated approval / repeated email credential dispatch
    if (app.status === 'approved' || app.credentialsSent) {
      return res.status(400).json({
        error: 'This application has already been approved. Login credentials can only be sent once upon initial approval.',
        alreadyApproved: true,
        sellerId: app.sellerId || null,
      });
    }

    // ACTION: APPROVE
    const secret = getAuthSecret();
    const sellerId = `seller_${crypto.randomBytes(5).toString('hex')}`;
    const randomSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    const tempPassword = `LA#${crypto.randomInt(100, 999)}@${randomSuffix}`;
    const passwordHash = hashSellerPassword(tempPassword, secret);

    const sellerRecord = {
      id: sellerId,
      email: String(app.email).toLowerCase().trim(),
      ownerName: app.applicantName || 'Partner',
      storeName: app.storeName || 'Creator Store',
      telegram: app.telegram || '',
      category: app.category || 'General',
      portfolioLink: app.portfolioLink || '',
      passwordHash,
      status: 'active',
      mustChangePassword: true,
      credentialsSent: true,
      createdAt: Date.now(),
      totalProducts: 0,
      totalOrders: 0,
      totalRevenue: 0,
    };

    // 1. Save to in-memory store immediately
    SELLER_MEMORY_STORE.sellers.set(sellerId, sellerRecord);
    if (SELLER_MEMORY_STORE.applications.has(applicationId)) {
      const memApp = SELLER_MEMORY_STORE.applications.get(applicationId);
      memApp.status = 'approved';
      memApp.sellerId = sellerId;
      memApp.reviewedAt = Date.now();
      memApp.credentialsSent = true;
    }

    // 2. Save seller to /events/sellers/${sellerId} (guaranteed write)
    try {
      await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sellerRecord),
      });

      if (adminToken) {
        fetch(`${RTDB_URL}/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sellerRecord),
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('RTDB background save notice:', e.message);
    }

    // 2. Mark application as approved in events and root
    const updateAppPayload = {
      status: 'approved',
      sellerId,
      reviewedAt: Date.now(),
      approvedAt: Date.now(),
      credentialsSent: true,
    };

    await fetch(`${RTDB_URL}/events/seller_applications/${encodeURIComponent(applicationId)}.json${authQuery}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateAppPayload),
    });

    if (adminToken) {
      fetch(`${RTDB_URL}/seller_applications/${encodeURIComponent(applicationId)}.json${authQuery}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateAppPayload),
      }).catch(() => {});
    }

    // 3. Send Credentials Email via Brevo API
    const apiKey = (process.env.BREVO_API_KEY || '').trim();
    const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'botforword@gmail.com').trim();
    const senderName = (process.env.BREVO_SENDER_NAME || 'Linkadda Online').trim();

    const reqHost = req.headers['host'] || req.headers['x-forwarded-host'] || '';
    const isLocal = reqHost.includes('localhost') || reqHost.includes('127.0.0.1');
    const portalUrl = isLocal ? `http://${reqHost}/seller/login` : 'https://linkadda.online/seller/login';

    let emailSent = false;
    if (apiKey) {
      try {
        const brevoPayload = {
          sender: { name: senderName, email: senderEmail },
          to: [{ email: sellerRecord.email, name: sellerRecord.ownerName }],
          subject: `🎉 Congratulations! Your LinkAdda Seller Account is Approved (${sellerRecord.storeName})`,
          htmlContent: renderSellerApprovalEmail(
            sellerRecord.ownerName,
            sellerRecord.storeName,
            sellerRecord.email,
            tempPassword,
            portalUrl
          ),
        };

        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': apiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify(brevoPayload),
        });

        if (brevoRes.ok) {
          emailSent = true;
        } else {
          const bErr = await brevoRes.text();
          console.warn('Brevo approval email dispatch notice:', bErr);
        }
      } catch (e) {
        console.warn('Brevo dispatch error:', e.message);
      }
    }

    return res.status(200).json({
      success: true,
      sellerId,
      email: sellerRecord.email,
      storeName: sellerRecord.storeName,
      emailSent,
      message: `Seller '${sellerRecord.storeName}' approved! Login credentials dispatched to ${sellerRecord.email}.`,
    });
  } catch (err) {
    console.error('Unexpected error in /api/seller/approve:', err);
    return res.status(500).json({ error: err.message || 'Server error approving seller.' });
  }
}

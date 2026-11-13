import { handleCors } from '../_utils.js';
import { notifyAdminsNewOrder } from './bot.js';
import { uploadBase64ToR2 } from '../_r2.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACTIVE_SUPABASE_URL = 'https://xazhsjotzoentrkminol.supabase.co';
const ACTIVE_SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhhemhzam90em9lbnRya21pbm9sIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NDU2MTM2NCwiZXhwIjoyMTEwMTM3MzY0fQ.sO_ZTRbmS7XInvK8YE6XEGz37URqzVmxxtsRABCGfHw';

function getSupabaseConfig() {
  let url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  let key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  // Guard: If env is missing or points to old/dead project, force active Supabase project
  if (!url || !url.includes('xazhsjotzoentrkminol')) {
    url = ACTIVE_SUPABASE_URL;
  }

  // Guard: If service key is missing or from old project, force active service key
  if (!key || !key.includes('xazhsjotzoentrkminol')) {
    key = ACTIVE_SUPABASE_SERVICE_KEY;
  }

  return { url, key };
}

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let order = req.body || {};
    if (typeof order === 'string') {
      try { order = JSON.parse(order); } catch (_) { order = {}; }
    }

    const orderId = String(order.order_id || order.id || order.orderId || '').trim();
    if (!orderId) {
      return res.status(400).json({ ok: false, error: 'Order ID is required' });
    }

    // 1. Guaranteed server-side upsert to Supabase 'orders' table (bypassing RLS with service role key)
    const { url: sbUrl, key: sbKey } = getSupabaseConfig();
    const rawAmt = order.numericAmount || String(order.amount || '').replace(/[^0-9.]/g, '');
    const cleanAmt = Number(rawAmt) || 0;
    const prodTitle = order.product_title || order.productTitle || order.productName || order.title || order.name || 'VIP Pack';
    const method = order.payment_method || order.method || 'UPI / QR';
    let proof = order.payment_proof || order.screenshotUrl || order.paymentProof || '';

    // Convert raw base64 screenshot into permanent Cloudflare R2 CDN URL before saving
    if (proof && (proof.startsWith('data:') || proof.includes('base64,'))) {
      try {
        const cleanOrdId = String(orderId).replace(/[^a-zA-Z0-9_-]/g, '_');
        const r2Url = await uploadBase64ToR2('payment screenshot', `proof_${cleanOrdId}_${Date.now()}.jpg`, proof);
        if (r2Url) {
          proof = r2Url;
        }
      } catch (r2Err) {
        console.warn('[R2 Upload Warning in notify-order]:', r2Err.message);
      }
    }

    const utr = order.utr || order.transactionId || '';
    const custName = order.customer_name || order.customerName || order.name || order.buyerName || order.telegramName || (order.telegramUsername ? `@${order.telegramUsername}` : 'Customer');

    const sourceBotId = order.sourceBotId || order.source_bot_id || order.data?.sourceBotId || null;
    const sourceBotUsername = order.sourceBotUsername || order.source_bot_username || order.data?.sourceBotUsername || null;

    // 🔒 2. SERVER-SIDE SECURITY AUDIT: Verify price against Supabase catalog & check duplicate UTR
    let isPriceTampered = false;
    let priceTamperNote = '';
    let expectedPriceINR = null;
    let expectedPriceUSD = null;

    let isDuplicateUtr = false;
    let duplicateUtrNote = '';
    let duplicateOrderId = '';

    const targetProdId = String(order.product_id || order.productId || '').trim();
    if (targetProdId) {
      try {
        const pRes = await fetch(`${sbUrl}/rest/v1/products?or=(id.eq.${encodeURIComponent(targetProdId)},product_id.eq.${encodeURIComponent(targetProdId)})&select=*`, {
          headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` },
          signal: AbortSignal.timeout(3500)
        });
        if (pRes.ok) {
          const pRows = await pRes.json();
          const p = pRows?.[0];
          if (p) {
            const reqTier = String(order.tier || order.data?.tier || '').trim().toLowerCase();
            const rawTiers = p.tiers || p.data?.tiers;
            if (reqTier && Array.isArray(rawTiers)) {
              const matchedTier = rawTiers.find(t => t && String(t.label || t.name || '').trim().toLowerCase() === reqTier);
              if (matchedTier) {
                expectedPriceINR = Number(String(matchedTier.inr || matchedTier.priceINR || '').replace(/[^0-9.]/g, '')) || null;
                expectedPriceUSD = Number(String(matchedTier.usd || matchedTier.priceUSD || '').replace(/[^0-9.]/g, '')) || null;
              }
            }
            if (!expectedPriceINR) {
              expectedPriceINR = Number(String(p.amount || p.inr || p.price_inr || p.priceINR || p.data?.amountINRValue || p.data?.inr || '').replace(/[^0-9.]/g, '')) || null;
            }
            if (!expectedPriceUSD) {
              expectedPriceUSD = Number(String(p.usd || p.price_usd || p.priceUSD || p.data?.amountUSDValue || p.data?.usd || '').replace(/[^0-9.]/g, '')) || null;
            }

            const isCurrencyUSD = String(order.currency || '').toUpperCase() === 'USD' || String(order.amount || '').startsWith('$');
            const expectedAmt = isCurrencyUSD ? expectedPriceUSD : expectedPriceINR;
            if (expectedAmt && expectedAmt > 0 && cleanAmt > 0) {
              if (cleanAmt < expectedAmt * 0.95) {
                isPriceTampered = true;
                const sym = isCurrencyUSD ? '$' : '₹';
                priceTamperNote = `Expected ${sym}${expectedAmt}, but submitted ${sym}${cleanAmt}`;
              }
            }
          }
        }
      } catch (pErr) {
        console.warn('[Security] Price check error:', pErr.message);
      }
    }

    const cleanUtr = String(utr || '').trim();
    if (cleanUtr && cleanUtr.length >= 6 && !/^(not|none|na|nil|null|test|0000)/i.test(cleanUtr)) {
      try {
        const utrRes = await fetch(`${sbUrl}/rest/v1/orders?utr=eq.${encodeURIComponent(cleanUtr)}&id=neq.${encodeURIComponent(orderId)}&select=id,status,created_at,product_title,amount&limit=1`, {
          headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` },
          signal: AbortSignal.timeout(3500)
        });
        if (utrRes.ok) {
          const uRows = await utrRes.json();
          if (uRows && uRows.length > 0) {
            const existing = uRows[0];
            isDuplicateUtr = true;
            duplicateOrderId = existing.id;
            duplicateUtrNote = `UTR already used in Order #${existing.id} (${existing.status || 'pending'}) for "${existing.product_title || 'Item'}"`;
          }
        }
      } catch (uErr) {
        console.warn('[Security] Duplicate UTR check error:', uErr.message);
      }
    }

    const orderRow = {
      id: orderId,
      order_id: orderId,
      customer_name: custName,
      customer_email: order.customer_email || order.customerEmail || order.email || '',
      customer_phone: order.customer_phone || order.customerPhone || order.phone || '',
      product_id: order.product_id || order.productId || '',
      product_title: prodTitle,
      amount: cleanAmt,
      currency: order.currency || (String(order.amount || '').startsWith('$') ? 'USD' : 'INR'),
      payment_method: method,
      payment_proof: proof,
      utr: utr,
      status: order.status || 'pending',
      data: {
        ...order,
        id: orderId,
        orderId,
        productTitle: prodTitle,
        amount: order.amount || cleanAmt,
        numericAmount: cleanAmt,
        expectedPriceINR,
        expectedPriceUSD,
        isPriceTampered,
        priceTamperNote,
        isDuplicateUtr,
        duplicateUtrNote,
        duplicateOrderId,
        paymentMethod: method,
        paymentProof: proof,
        utr,
        customerName: custName,
        telegramUserId: order.telegramUserId || order.data?.telegramUserId || order.telegram_user_id || '',
        telegramUsername: order.telegramUsername || order.data?.telegramUsername || order.telegram || '',
        sourceBotId,
        sourceBotUsername
      }
    };

    // 3. Parallel execution: Run database persistence and Telegram dispatch concurrently
    const dbSavePromise = (async () => {
      try {
        const sbRes = await fetch(`${sbUrl}/rest/v1/orders`, {
          method: 'POST',
          headers: {
            'apikey': sbKey,
            'Authorization': `Bearer ${sbKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify([orderRow]),
          signal: AbortSignal.timeout(6000)
        });
        if (!sbRes.ok) {
          const errText = await sbRes.text().catch(() => '');
          console.error('[notify-order DB save failed]:', sbRes.status, errText);
        }
        return sbRes.ok;
      } catch (sbErr) {
        console.warn('Server-side order save error:', sbErr.message);
        return false;
      }
    })();

    const tgNotifyPromise = (async () => {
      try {
        return await notifyAdminsNewOrder({
          ...order,
          ...orderRow,
          order_id: orderId,
          id: orderId,
          product_title: prodTitle,
          amount: order.amount || `₹${cleanAmt}`,
          payment_proof: proof,
          utr: utr,
          isPriceTampered,
          priceTamperNote,
          isDuplicateUtr,
          duplicateUtrNote,
          duplicateOrderId,
          telegramUserId: order.telegramUserId || order.data?.telegramUserId || order.telegram_user_id || '',
          telegramUsername: order.telegramUsername || order.data?.telegramUsername || order.telegram || '',
          sourceBotId,
          sourceBotUsername
        });
      } catch (tgErr) {
        console.warn('notifyAdminsNewOrder error in endpoint:', tgErr.message);
        return { ok: false, error: tgErr.message };
      }
    })();

    const [supabaseSaved, telegramResult] = await Promise.all([dbSavePromise, tgNotifyPromise]);

    return res.status(200).json({
      ok: true,
      orderId,
      savedToDatabase: Boolean(supabaseSaved),
      telegramNotification: telegramResult
    });
  } catch (err) {
    console.error('api/telegram/notify-order fatal error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

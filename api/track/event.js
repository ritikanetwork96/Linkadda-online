import { handleCors } from '../_utils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACTIVE_SUPABASE_URL = 'https://xazhsjotzoentrkminol.supabase.co';
const ACTIVE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhhemhzam90em9lbnRya21pbm9sIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NDU2MTM2NCwiZXhwIjoyMTEwMTM3MzY0fQ.sO_ZTRbmS7XInvK8YE6XEGz37URqzVmxxtsRABCGfHw';

function getSupabaseConfig() {
  let url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  let key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!url || !url.includes('xazhsjotzoentrkminol')) url = ACTIVE_SUPABASE_URL;
  if (!key || !key.includes('xazhsjotzoentrkminol')) key = ACTIVE_SERVICE_KEY;

  return { url, key };
}

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST, GET, OPTIONS')) return;

  let data = (req.method === 'POST' ? req.body : req.query) || {};
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (_) {}
  }
  const eventType = String(data.event_type || data.eventType || data.type || 'order_click').trim();
  const productId = data.product_id || data.productId || null;
  const productTitle = data.product_title || data.productTitle || data.name || data.title || null;
  const visitorId = data.visitor_id || data.visitorId || null;
  const source = String(data.source || (data.isTg ? 'mini_app' : 'website'));
  const name = String(data.name || data.tgName || '').trim();
  const username = String(data.username || data.tgUsername || '').trim().replace(/^@/, '');
  const botId = data.botId || data.sourceBotId || null;
  const botUsername = data.botUsername || data.sourceBotUsername || null;
  const priceINR = data.price_inr ?? data.priceINR ?? null;
  const priceUSD = data.price_usd ?? data.priceUSD ?? null;
  const page = String(data.page || 'index');
  const button = String(data.button || 'order_button');

  const { url, key } = getSupabaseConfig();
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  const payload = {
    event_type: eventType,
    product_id: productId ? String(productId) : null,
    product_title: productTitle ? String(productTitle) : null,
    visitor_id: visitorId ? String(visitorId) : null,
    data: {
      eventType,
      productId,
      productTitle,
      priceINR,
      priceUSD,
      source,
      name,
      username,
      botId,
      botUsername,
      page,
      button,
      timestamp: Date.now()
    }
  };

  try {
    const sbRes = await fetch(`${url}/rest/v1/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify([payload]),
      signal: AbortSignal.timeout(4000)
    });

    return res.status(200).json({ ok: true, eventType, productId, source });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
}

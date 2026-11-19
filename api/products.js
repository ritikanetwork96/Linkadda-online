import { handleCors } from './_utils.js';

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

  let body = (req.method === 'POST' ? req.body : req.query) || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {}
  }

  const action = String(body.action || '').trim().toLowerCase();
  const productId = String(body.productId || body.product_id || '').trim();
  const { url, key } = getSupabaseConfig();
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  try {
    if (action === 'toggle_like') {
      const isLiked = Boolean(body.isLiked);
      const payload = {
        event_type: 'product_like',
        product_id: productId || null,
        data: {
          eventType: 'product_like',
          action: 'toggle_like',
          productId,
          isLiked,
          timestamp: Date.now()
        }
      };
      await fetch(`${url}/rest/v1/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify([payload]),
        signal: AbortSignal.timeout(3000)
      }).catch(() => {});

      return res.status(200).json({ success: true, productId, isLiked });
    }

    if (action === 'track_view') {
      const payload = {
        event_type: 'product_view',
        product_id: productId || null,
        data: {
          eventType: 'product_view',
          action: 'track_view',
          productId,
          timestamp: Date.now()
        }
      };
      await fetch(`${url}/rest/v1/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify([payload]),
        signal: AbortSignal.timeout(3000)
      }).catch(() => {});

      return res.status(200).json({ success: true, productId });
    }

    if (action === 'track_share' || action === 'share') {
      const productTitle = String(body.productTitle || body.product_title || '').trim();
      const payload = {
        event_type: 'product_share',
        product_id: productId || null,
        product_title: productTitle || null,
        data: {
          eventType: 'product_share',
          action: 'track_share',
          productId,
          productTitle,
          timestamp: Date.now()
        }
      };
      await fetch(`${url}/rest/v1/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify([payload]),
        signal: AbortSignal.timeout(3000)
      }).catch(() => {});

      return res.status(200).json({ success: true, productId });
    }

    return res.status(200).json({ success: true, action: action || 'ok' });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
}


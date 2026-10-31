import { handleCors, verifyAdminRequest, getClientIp } from '../_utils.js';

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Enforce strict Admin Authorization
  const isAuthorized = await verifyAdminRequest(req);
  if (!isAuthorized) {
    console.warn(`[SECURITY ALERT] Unauthorized admin DB write attempt from IP ${getClientIp(req)}`);
    return res.status(403).json({ error: 'Forbidden. Valid Admin session required to perform database writes.' });
  }

  // 2. Load private Service Role credentials on the server
  const supaUrl = (process.env.SUPABASE_URL || 'https://mkttxqwpbostzmfygpzq.supabase.co').replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!serviceKey) {
    return res.status(500).json({ error: 'Server configuration error: Service role key missing.' });
  }

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  try {
    let body = req.body;
    if (!body && typeof req.on === 'function') {
      body = await new Promise((resolve) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
        });
        req.on('error', () => resolve({}));
      });
    } else if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};

    const { action, table, id, data, isSingleton } = body;

    // Validate table name to prevent SQL injection or table spoofing
    const ALLOWED_TABLES = ['products', 'categories', 'orders', 'visitors', 'events', 'site_settings'];
    if (!isSingleton && !ALLOWED_TABLES.includes(table)) {
      return res.status(400).json({ error: `Invalid table: ${table}` });
    }

    function parseMoney(val) {
      if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
      const cleaned = String(val || '').replace(/[^\d.]/g, '');
      const num = parseFloat(cleaned);
      return Number.isFinite(num) ? num : 0;
    }

    if (action === 'get' || action === 'list') {
      if (isSingleton) {
        const getRes = await fetch(`${supaUrl}/rest/v1/site_settings?key=eq.${encodeURIComponent(id || '')}&select=*`, { headers, cache: 'no-store' });
        const rows = getRes.ok ? await getRes.json() : [];
        const val = rows && rows.length ? rows[0].value : null;
        return res.status(200).json({ success: true, data: val });
      }

      const orderParam = table === 'products' ? '&order=display_order.asc' : '&order=created_at.desc';
      const endpoint = id
        ? `${supaUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`
        : `${supaUrl}/rest/v1/${table}?select=*${orderParam}`;
      const getRes = await fetch(endpoint, { headers, cache: 'no-store' });
      const rows = getRes.ok ? await getRes.json() : [];
      return res.status(200).json({ success: true, rows });
    }

    if (action === 'set') {
      if (isSingleton) {
        const setRes = await fetch(`${supaUrl}/rest/v1/site_settings`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify([{ key: id, value: data, updated_at: new Date().toISOString() }])
        });
        if (!setRes.ok) {
          const errText = await setRes.text();
          return res.status(setRes.status).json({ error: errText });
        }
        return res.status(200).json({ success: true });
      }

      const itemId = String(id || data?.id || `item_${Date.now()}`);
      const row = {
        id: itemId,
        slug: data?.slug || itemId,
        title: data?.title || data?.name || '',
        data: data
      };
      if (table === 'products') {
        row.category = data?.category || '';
        row.price_inr = parseMoney(data?.priceINR || data?.price_inr || data?.inr);
        row.price_usd = parseMoney(data?.priceUSD || data?.price_usd || data?.usd);
        row.status = data?.status || 'active';
        row.image = data?.image || '';
        row.display_order = Number(data?.displayOrder || data?.display_order) || 0;
        if (data?.badge !== undefined) row.badge = data.badge;
      } else if (table === 'categories') {
        row.name = data?.name || data?.title || '';
        row.image = data?.image || '';
        row.display_order = Number(data?.displayOrder || data?.display_order) || 0;
      } else if (table === 'orders') {
        row.order_id = String(data?.orderId || itemId);
        row.customer_name = data?.customerName || data?.name || '';
        row.customer_email = data?.customerEmail || data?.email || '';
        row.amount = parseMoney(data?.amount || data?.totalAmount || 0);
        row.status = data?.status || data?.orderStatus || 'pending';
        row.payment_method = data?.paymentMethod || '';
        row.utr = data?.utr || '';
        row.payment_proof = data?.paymentProof || '';
      }

      const setRes = await fetch(`${supaUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([row])
      });
      if (!setRes.ok) {
        const errText = await setRes.text();
        return res.status(setRes.status).json({ error: errText });
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'update') {
      if (isSingleton) {
        const setRes = await fetch(`${supaUrl}/rest/v1/site_settings`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify([{ key: id, value: data, updated_at: new Date().toISOString() }])
        });
        return res.status(200).json({ success: setRes.ok });
      }

      // Handle batch updates (e.g. reordering displayOrder across multiple items)
      if (!id) {
        const entries = Object.entries(data || {});
        for (const [key, val] of entries) {
          let rowId = key;
          let patchObj = val;
          if (key.includes('/')) {
            const [rId, field] = key.split('/');
            rowId = rId;
            patchObj = { [field]: val };
          }
          if (rowId) {
            const dbPatch = { updated_at: new Date().toISOString() };
            if (patchObj.displayOrder !== undefined) dbPatch.display_order = Number(patchObj.displayOrder) || 0;
            if (patchObj.status !== undefined) dbPatch.status = patchObj.status;
            await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(rowId)}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify(dbPatch)
            });
          }
        }
        return res.status(200).json({ success: true });
      }

      // Fetch existing row to merge data safely
      const getRes = await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`, { headers });
      const rows = getRes.ok ? await getRes.json() : [];
      const existing = rows?.[0]?.data || rows?.[0] || {};
      const merged = { ...existing, ...data };

      const patchBody = {
        data: merged,
        updated_at: new Date().toISOString()
      };
      if (table === 'products') {
        if (merged.title || merged.name) patchBody.title = merged.title || merged.name;
        if (merged.slug) patchBody.slug = merged.slug;
        if (merged.category !== undefined) patchBody.category = merged.category;
        const inrNum = parseMoney(merged.priceINR ?? merged.price_inr ?? merged.inr);
        if (inrNum > 0 || merged.priceINR !== undefined) patchBody.price_inr = inrNum;
        const usdNum = parseMoney(merged.priceUSD ?? merged.price_usd ?? merged.usd);
        if (usdNum > 0 || merged.priceUSD !== undefined) patchBody.price_usd = usdNum;
        if (merged.status) patchBody.status = merged.status;
        if (merged.image) patchBody.image = merged.image;
        if (merged.displayOrder !== undefined) patchBody.display_order = Number(merged.displayOrder) || 0;
        if (merged.badge !== undefined) patchBody.badge = merged.badge;
      } else if (table === 'categories') {
        if (merged.name || merged.title) patchBody.name = merged.name || merged.title;
        if (merged.slug) patchBody.slug = merged.slug;
        if (merged.image) patchBody.image = merged.image;
        if (merged.displayOrder !== undefined) patchBody.display_order = Number(merged.displayOrder) || 0;
      } else if (table === 'orders') {
        if (merged.status) patchBody.status = merged.status;
      }

      const patchRes = await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patchBody)
      });
      return res.status(200).json({ success: patchRes.ok });
    }

    if (action === 'remove') {
      if (isSingleton) {
        await fetch(`${supaUrl}/rest/v1/site_settings?key=eq.${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers
        });
        return res.status(200).json({ success: true });
      }
      if (id) {
        await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers
        });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('Admin DB handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error in DB proxy.' });
  }
}

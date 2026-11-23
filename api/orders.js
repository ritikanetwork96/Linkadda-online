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
  if (handleCors(req, res, 'GET, POST, OPTIONS')) return;

  const { url, key } = getSupabaseConfig();
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  };

  // GET: Lookup order status by orderId, customerUid, visitorId, tgUserId, etc.
  if (req.method === 'GET') {
    const q = req.query || {};
    const orderId = String(q.orderId || q.order_id || q.id || '').trim();
    const customerUid = String(q.customerUid || q.customer_uid || '').trim();
    const visitorId = String(q.visitorId || q.visitor_id || '').trim();
    const tgUserId = String(q.tgUserId || q.telegramUserId || q.tg_user_id || '').trim();
    const email = String(q.email || q.customerEmail || '').trim().toLowerCase();
    const phone = String(q.phone || q.customerPhone || '').trim();

    if (!orderId && !customerUid && !visitorId && !tgUserId && !email && !phone) {
      return res.status(400).json({ success: false, error: 'Query parameter (orderId, customerUid, visitorId, etc.) required' });
    }

    try {
      if (orderId) {
        // Query by id or order_id
        const supaRes = await fetch(`${url}/rest/v1/orders?or=(id.eq.${encodeURIComponent(orderId)},order_id.eq.${encodeURIComponent(orderId)})&select=*`, {
          headers
        });

        if (!supaRes.ok) {
          const errText = await supaRes.text();
          return res.status(500).json({ success: false, error: 'Database query failed: ' + errText });
        }

        const rows = await supaRes.json();
        if (!rows || !rows.length) {
          return res.status(404).json({ success: false, error: 'Order not found' });
        }

        const orderRow = rows[0];
        const data = orderRow.data || {};
        const isApproved = 
          orderRow.status === 'approved' ||
          orderRow.status === 'completed' ||
          orderRow.status === 'paid' ||
          data.status === 'approved' ||
          data.orderStatus === 'approved' ||
          data.paymentStatus === 'approved' ||
          data.approved === true;

        let channelLink = orderRow.channel_link || data.channelLink || data.downloadLink || data.fileUrl || data.orderLink || '';
        if (channelLink.includes('VIP_KINK') || channelLink.includes('TRUSTED_BROTHER')) channelLink = '';

        // If approved but no link, resolve from original product in Supabase
        const productId = orderRow.product_id || data.productId;
        if (isApproved && !channelLink && productId) {
          try {
            const pRes = await fetch(`${url}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=channelLink,deliveryLink,fileUrl`, {
              headers
            });
            if (pRes.ok) {
              const pRows = await pRes.json();
              if (pRows && pRows.length) {
                channelLink = pRows[0].channelLink || pRows[0].deliveryLink || pRows[0].fileUrl || '';
              }
            }
          } catch (_) {}
        }

        return res.status(200).json({
          success: true,
          order: {
            orderId: orderRow.order_id || orderRow.id,
            productName: orderRow.product_title || data.productName || data.name || 'VIP Content Pack',
            productTitle: orderRow.product_title || data.productName || data.name || 'VIP Content Pack',
            productId: productId || '',
            image: data.image || data.imageUrl || data.img || '',
            amount: orderRow.amount || data.amountINR || data.amount || 0,
            amountDisplay: data.amountDisplay || `₹${orderRow.amount || data.amountINR || data.amount || 0}`,
            currency: orderRow.currency || data.currency || 'INR',
            paymentMethod: orderRow.payment_method || data.paymentMethod || 'UPI',
            paymentProof: orderRow.payment_proof || data.paymentProof || data.screenshotUrl || '',
            utr: orderRow.utr || data.utr || '',
            status: isApproved ? 'approved' : (orderRow.status === 'rejected' || data.status === 'rejected' ? 'rejected' : 'pending'),
            channelLink: channelLink || '',
            downloadLink: channelLink || '',
            createdAt: orderRow.created_at || data.createdAt || Date.now(),
            approvedAt: data.approvedAt || orderRow.updated_at || null
          }
        });
      }

      // Query collection of orders for user session
      const supaRes = await fetch(`${url}/rest/v1/orders?select=*&order=created_at.desc&limit=100`, {
        headers
      });
      if (!supaRes.ok) {
        return res.status(500).json({ success: false, error: 'Database query failed' });
      }
      const rows = await supaRes.json();
      const customerOrders = (rows || []).filter(r => {
        const d = r.data || {};
        if (customerUid && (d.customerUid === customerUid || d.uid === customerUid)) return true;
        if (visitorId && (d.visitorId === visitorId || d.visitor_id === visitorId)) return true;
        if (tgUserId && (String(d.telegramUserId) === tgUserId || String(d.tgUserId) === tgUserId)) return true;
        if (email && (String(r.customer_email).toLowerCase() === email || String(d.customerEmail).toLowerCase() === email)) return true;
        if (phone && (String(r.customer_phone) === phone || String(d.customerPhone) === phone)) return true;
        return false;
      }).map(r => {
        const d = r.data || {};
        const isApproved = r.status === 'approved' || d.status === 'approved' || d.approved === true;
        return {
          orderId: r.order_id || r.id,
          productId: r.product_id || d.productId || '',
          productName: r.product_title || d.productName || 'VIP Content Pack',
          productTitle: r.product_title || d.productName || 'VIP Content Pack',
          image: d.image || d.imageUrl || d.img || '',
          amount: r.amount || d.amount || 0,
          amountDisplay: d.amountDisplay || `₹${r.amount || d.amount || 0}`,
          currency: r.currency || 'INR',
          paymentMethod: r.payment_method || d.paymentMethod || 'UPI',
          paymentProof: r.payment_proof || d.paymentProof || '',
          status: isApproved ? 'approved' : (r.status || 'pending'),
          channelLink: isApproved ? (r.channel_link || d.channelLink || '') : '',
          downloadLink: isApproved ? (r.channel_link || d.channelLink || '') : '',
          createdAt: r.created_at || d.createdAt || Date.now(),
          date: r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Recently'
        };
      });

      return res.status(200).json({ success: true, orders: customerOrders });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST: Securely persist / upsert order
  if (req.method === 'POST') {
    let payload = req.body || {};
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) {}
    }

    const orderId = payload.orderId || payload.order_id || payload.id;
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'orderId is required' });
    }

    try {
      // Strip base64 raw data from nested data to protect bandwidth & memory
      const safeData = { ...(payload.data || payload) };
      if (typeof safeData.screenshotRaw === 'string' && safeData.screenshotRaw.startsWith('data:')) {
        delete safeData.screenshotRaw;
      }
      if (typeof safeData.paymentProof === 'string' && safeData.paymentProof.startsWith('data:')) {
        safeData.paymentProof = '';
      }

      const orderRow = {
        id: orderId,
        order_id: orderId,
        customer_name: payload.customerName || payload.name || 'Customer',
        customer_email: payload.customerEmail || payload.email || '',
        customer_phone: payload.customerPhone || payload.phone || '',
        product_id: payload.productId || '',
        product_title: payload.productTitle || payload.productName || payload.title || 'VIP Pack',
        amount: Number(payload.amount || payload.priceINR || 0) || 0,
        currency: payload.currency || 'INR',
        payment_method: payload.paymentMethod || 'UPI',
        payment_proof: payload.paymentProof || payload.screenshotUrl || '',
        utr: payload.utr || payload.transactionId || '',
        status: payload.status || 'pending',
        data: safeData
      };

      const supaRes = await fetch(`${url}/rest/v1/orders`, {
        method: 'POST',
        headers: {
          ...headers,
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify([orderRow])
      });

      if (!supaRes.ok) {
        const errText = await supaRes.text();
        return res.status(500).json({ success: false, error: errText });
      }

      return res.status(200).json({ success: true, orderId, order: orderRow });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
}

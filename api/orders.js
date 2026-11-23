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

  // GET: Lookup order status by orderId or customerUid
  if (req.method === 'GET') {
    const q = req.query || {};
    const orderId = String(q.orderId || q.order_id || q.id || '').trim();
    const customerUid = String(q.customerUid || q.customer_uid || '').trim();

    if (!orderId && !customerUid) {
      return res.status(400).json({ success: false, error: 'orderId or customerUid is required' });
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
            productId: productId || '',
            amount: orderRow.amount || data.amountINR || data.amount || 0,
            currency: orderRow.currency || data.currency || 'INR',
            paymentMethod: orderRow.payment_method || data.paymentMethod || 'UPI',
            status: isApproved ? 'approved' : (orderRow.status === 'rejected' || data.status === 'rejected' ? 'rejected' : 'pending'),
            channelLink: channelLink || '',
            downloadLink: channelLink || '',
            createdAt: orderRow.created_at || data.createdAt || Date.now(),
            approvedAt: data.approvedAt || orderRow.updated_at || null
          }
        });
      }

      if (customerUid) {
        // Query by customerUid in data
        const supaRes = await fetch(`${url}/rest/v1/orders?select=*&limit=50`, {
          headers
        });
        if (!supaRes.ok) {
          return res.status(500).json({ success: false, error: 'Database query failed' });
        }
        const rows = await supaRes.json();
        const customerOrders = (rows || []).filter(r => {
          const d = r.data || {};
          return d.customerUid === customerUid || d.telegramUserId === customerUid || r.customer_email === customerUid || r.customer_phone === customerUid;
        }).map(r => {
          const d = r.data || {};
          const isApproved = r.status === 'approved' || d.status === 'approved' || d.approved === true;
          return {
            orderId: r.order_id || r.id,
            productName: r.product_title || d.productName || 'VIP Content Pack',
            amount: r.amount || d.amount || 0,
            currency: r.currency || 'INR',
            status: isApproved ? 'approved' : (r.status || 'pending'),
            channelLink: isApproved ? (r.channel_link || d.channelLink || '') : '',
            createdAt: r.created_at || d.createdAt || Date.now()
          };
        });

        return res.status(200).json({ success: true, orders: customerOrders });
      }
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
        data: payload.data || payload
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

      return res.status(200).json({ success: true, orderId });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
}

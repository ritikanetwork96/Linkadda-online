import { handleCors } from '../_utils.js';
import { broadcastNewProduct, broadcastCustomMessage } from './bot.js';

/**
 * Dedicated Telegram Broadcast Endpoint for Vercel & Node Server
 * POST /api/telegram/broadcast
 */
export default async function handler(req, res) {
  if (handleCors(req, res, 'GET, POST, OPTIONS')) return;

  if (req.method === 'POST') {
    try {
      const body = req.body || {};

      // Detect if this is an admin custom announcement or a catalog product
      const isCustomText = body.type === 'custom' || 
        (typeof body.message === 'string' && body.message.trim().length > 0 && !body.id && !body.productId && !body.product && !body.badge && !body.priceINR);

      const targetBotIds = body.targetBotIds || (body.product && body.product.targetBotIds) || ['all'];

      if (isCustomText) {
        const result = await broadcastCustomMessage({ ...body, targetBotIds });
        return res.status(result.ok ? 200 : 400).json(result);
      }

      // Catalog Product Broadcast (handles { type: 'product', ... }, { product: {...} }, or raw product item)
      const productData = body.product || body;
      const result = await broadcastNewProduct(productData, targetBotIds);
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      console.error('Telegram broadcast error:', e);
      return res.status(500).json({ ok: false, error: e.message || 'Failed to broadcast' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

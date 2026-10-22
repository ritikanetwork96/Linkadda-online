import { handleCors } from '../_utils.js';
import { broadcastNewProduct } from './bot.js';

/**
 * Dedicated Telegram Broadcast Endpoint for Vercel & Node Server
 * POST /api/telegram/broadcast
 */
export default async function handler(req, res) {
  if (handleCors(req, res, 'GET, POST, OPTIONS')) return;

  if (req.method === 'POST') {
    try {
      const product = req.body || {};
      const result = await broadcastNewProduct(product);
      return res.status(200).json(result);
    } catch (e) {
      console.error('Telegram broadcast error:', e);
      return res.status(500).json({ ok: false, error: e.message || 'Failed to broadcast' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

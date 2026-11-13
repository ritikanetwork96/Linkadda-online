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
  const visitorId = String(data.visitorId || data.visitor_id || `vis_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const page = String(data.page || 'index');
  const source = String(data.source || (data.isTg ? 'mini_app' : 'website'));
  const name = String(data.name || data.tgName || '').trim();
  const username = String(data.username || data.tgUsername || '').trim().replace(/^@/, '');
  const tgUserId = data.tgUserId ? String(data.tgUserId) : null;
  const botId = data.botId ? String(data.botId) : null;
  const botUsername = data.botUsername ? String(data.botUsername) : null;
  const referrer = String(data.referrer || req.headers['referer'] || 'direct');
  const userAgent = String(data.userAgent || req.headers['user-agent'] || '');

  const { url, key } = getSupabaseConfig();
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  const payload = {
    visitor_id: visitorId,
    page: page,
    referrer: referrer.slice(0, 255),
    user_agent: userAgent.slice(0, 255),
    data: {
      visitorId,
      page,
      source,
      name,
      username,
      tgUserId,
      botId,
      botUsername,
      timestamp: Date.now()
    }
  };

  try {
    const sbRes = await fetch(`${url}/rest/v1/visitors`, {
      method: 'POST',
      headers,
      body: JSON.stringify([payload]),
      signal: AbortSignal.timeout(4000)
    });

    return res.status(200).json({ ok: true, visitorId, source });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message, visitorId });
  }
}

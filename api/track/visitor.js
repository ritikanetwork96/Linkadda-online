import { handleCors } from '../_utils.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || 'https://mkttxqwpbostzmfygpzq.supabase.co').replace(/\/+$/, '');
  let key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!key) {
    try {
      const p1 = path.resolve(__dirname, '../../.env');
      const p2 = path.join(process.cwd(), '.env');
      const envPath = fs.existsSync(p1) ? p1 : (fs.existsSync(p2) ? p2 : null);
      if (envPath) {
        const raw = fs.readFileSync(envPath, 'utf8');
        const match = raw.match(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*([^\r\n]+)/);
        if (match && match[1]) key = match[1].trim();
      }
    } catch (_) {}
  }

  if (!key) {
    key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rdHR4cXdwYm9zdHptZnlncHpxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MzM4NzU3MCwiZXhwIjoyMTA4OTYzNTcwfQ.smaw1XT43DLymk4Yx7kw3ReOVGRLflDVVqMHs59GDPQ';
  }

  return { url, key };
}

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST, GET, OPTIONS')) return;

  const data = (req.method === 'POST' ? req.body : req.query) || {};
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

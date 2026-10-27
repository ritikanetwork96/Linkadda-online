import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleCors, verifyAdminRequest } from '../_utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_ADMIN_IDS = ['8802192472', '6966868142'];

export function getAdminChatIds() {
  try {
    const store = readBotStore();
    if (Array.isArray(store.admins) && store.admins.length > 0) {
      return store.admins.map(s => String(s).trim()).filter(Boolean);
    }
  } catch (_) {}
  const envAdmins = (process.env.ADMIN_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return envAdmins.length > 0 ? envAdmins : DEFAULT_ADMIN_IDS;
}

export function getAppUrl(req = null) {
  if (req && req.headers) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      const proto = req.headers['x-forwarded-proto'] || 'https';
      return `${proto}://${host}`.replace(/\/+$/, '');
    }
  }
  const base = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || 'https://linkadda-online.onrender.com';
  return base.replace(/\/+$/, '');
}

function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || 'https://esxiwfswnbacmpjxqgsn.supabase.co').replace(/\/+$/, '');
  let key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  // If in local dev and process.env is empty, check .env file safely without hardcoding
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

  // Fallback to anon key if service role is unset
  if (!key) {
    key = (process.env.SUPABASE_ANON_KEY || '').trim();
  }

  return { url, key };
}

// ── Ultra-Fast Persistent Multi-Bot Storage Engine ──────────────────────
let _activeBotStorePath = null;
function getBotStorePath() {
  if (_activeBotStorePath) return _activeBotStorePath;
  const p1 = path.resolve(__dirname, '../../data/bot_store.json');
  if (fs.existsSync(p1)) {
    try {
      fs.accessSync(p1, fs.constants.W_OK);
      _activeBotStorePath = p1;
      return p1;
    } catch (_) {}
  }
  const p2 = path.join(process.cwd(), 'data', 'bot_store.json');
  try {
    const dir = path.dirname(p2);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    _activeBotStorePath = p2;
    return p2;
  } catch (_) {}

  // Serverless fallback: /tmp is the only writable directory on Vercel/AWS Lambda
  const tmpPath = path.join('/tmp', 'bot_store.json');
  _activeBotStorePath = tmpPath;
  return tmpPath;
}

function readBotStore() {
  if (globalThis.__linkadda_bot_store && globalThis.__linkadda_bot_store.bots) {
    return globalThis.__linkadda_bot_store;
  }
  try {
    const filePath = getBotStorePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      globalThis.__linkadda_bot_store = parsed;
      return parsed;
    }
  } catch (err) {
    console.warn('Local bot_store.json read note:', err.message);
  }
  // Try reading static seed file from repo if tmp file doesn't exist yet
  try {
    const seedPath = path.resolve(__dirname, '../../data/bot_store.json');
    if (fs.existsSync(seedPath)) {
      const parsed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      globalThis.__linkadda_bot_store = parsed;
      return parsed;
    }
  } catch (_) {}

  const defaultStore = {
    activeToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    bot: {
      username: 'Myshop9876_bot',
      name: 'LinkAdda Store Bot',
      id: '8923608774',
      status: 'active',
      isPrimary: true,
      source: 'database',
      lastActivatedAt: new Date().toISOString()
    },
    admins: DEFAULT_ADMIN_IDS,
    users: {},
    pendingDeletions: {},
    orderLinks: {},
    orderAdminMessages: {}
  };
  globalThis.__linkadda_bot_store = defaultStore;
  return defaultStore;
}

function writeBotStore(data) {
  try {
    globalThis.__linkadda_bot_store = data;
    const filePath = getBotStorePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Local bot_store.json write error:', err.message);
    try {
      const tmpPath = path.join('/tmp', 'bot_store.json');
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      _activeBotStorePath = tmpPath;
      return true;
    } catch (_) {}
    return false;
  }
}

export async function syncBotsToSupabase(botsMap) {
  try {
    const { url, key } = getSupabaseConfig();
    const res = await fetch(`${url}/rest/v1/site_settings`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify([{ key: 'tg_connected_bots', value: botsMap, updated_at: new Date().toISOString() }]),
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch (err) {
    console.warn('syncBotsToSupabase warning:', err.message);
    return false;
  }
}

let lastBotStoreSyncTime = 0;
export async function syncBotsFromSupabase(force = false) {
  const now = Date.now();
  if (!force && now - lastBotStoreSyncTime < 5000) {
    return readBotStore()?.bots || {};
  }
  lastBotStoreSyncTime = now;
  try {
    const { url, key } = getSupabaseConfig();
    const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
    const res = await fetch(`${url}/rest/v1/site_settings?key=in.(tg_connected_bots,tg_admin_chat_ids,tg_admin_profiles)&select=*`, {
      headers,
      signal: AbortSignal.timeout(4500)
    }).catch(() => null);

    if (res && res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const store = readBotStore();
        let changed = false;
        for (const row of rows) {
          if (row.key === 'tg_connected_bots' && row.value && typeof row.value === 'object') {
            store.bots = { ...(store.bots || {}), ...row.value };
            changed = true;
          }
          if (row.key === 'tg_admin_chat_ids' && Array.isArray(row.value) && row.value.length > 0) {
            store.admins = row.value.map(s => String(s).trim()).filter(Boolean);
            changed = true;
          }
          if (row.key === 'tg_admin_profiles' && row.value && typeof row.value === 'object') {
            store.adminProfiles = { ...(store.adminProfiles || {}), ...row.value };
            changed = true;
          }
        }
        if (changed) {
          writeBotStore(store);
        }
        return store.bots || {};
      }
    }
  } catch (err) {
    console.warn('syncBotsFromSupabase warning:', err.message);
  }
  return readBotStore()?.bots || {};
}

function formatBotRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw.botId || '').replace(/^bot_/, '');
  const botId = `bot_${id}`;
  return {
    id,
    botId,
    token: String(raw.token || '').trim(),
    username: String(raw.username || '').replace('@', '').trim(),
    name: String(raw.name || raw.first_name || 'LinkAdda Bot').trim(),
    status: raw.status === 'inactive' ? 'inactive' : 'active',
    isPrimary: Boolean(raw.isPrimary),
    createdAt: raw.createdAt || Date.now(),
    lastActivatedAt: raw.lastActivatedAt || new Date().toISOString(),
    subscribersCount: Number(raw.subscribersCount) || 0
  };
}

export function getConnectedBots() {
  const store = readBotStore();
  let botsMap = store.bots;
  if (!botsMap || typeof botsMap !== 'object' || Object.keys(botsMap).length === 0) {
    const defaultToken = (store.activeToken || process.env.TELEGRAM_BOT_TOKEN || '8923608774:AAFhvO4Yzly7toIf5qoI-TSW4EzVzWCdVlE').trim();
    const b = store.bot || {};
    const bid = String(b.id || '8923608774');
    botsMap = {
      [`bot_${bid}`]: {
        id: bid,
        botId: `bot_${bid}`,
        token: defaultToken,
        username: b.username || 'Myshop9876_bot',
        name: b.name || 'LinkAdda Store Bot',
        status: 'active',
        isPrimary: true,
        createdAt: Date.now(),
        lastActivatedAt: b.lastActivatedAt || new Date().toISOString()
      }
    };
    store.bots = botsMap;
    writeBotStore(store);
  }

  // Auto-discover any bots recorded in user activity so no fleet bot is ever omitted
  if (store.users && typeof store.users === 'object') {
    let hasNewBot = false;
    for (const u of Object.values(store.users)) {
      if (u && u.bots && typeof u.bots === 'object') {
        for (const [bKey, bVal] of Object.entries(u.bots)) {
          const bUname = String(bVal?.botUsername || bVal?.username || bKey.replace(/^bot_/, '')).replace('@', '').trim();
          const bId = String(bVal?.botId || bKey).trim();
          const canonId = bId.startsWith('bot_') ? bId : `bot_${bId}`;
          if (bUname && !botsMap[canonId] && !botsMap[bKey]) {
            botsMap[canonId] = {
              id: canonId.replace(/^bot_/, ''),
              botId: canonId,
              token: bVal?.token || '',
              username: bUname,
              name: `@${bUname}`,
              status: 'active',
              isPrimary: false,
              createdAt: bVal?.joinedAt || Date.now(),
              subscribersCount: 0
            };
            hasNewBot = true;
          }
        }
      }
      if (u && u.sourceBotUsername) {
        const sUname = String(u.sourceBotUsername).replace('@', '').trim();
        const sId = String(u.sourceBotId || `bot_${sUname}`).trim();
        const canonId = sId.startsWith('bot_') ? sId : `bot_${sId}`;
        if (sUname && !botsMap[canonId] && !botsMap[sId]) {
          botsMap[canonId] = {
            id: canonId.replace(/^bot_/, ''),
            botId: canonId,
            token: '',
            username: sUname,
            name: `@${sUname}`,
            status: 'active',
            isPrimary: false,
            createdAt: u.createdAt || Date.now(),
            subscribersCount: 0
          };
          hasNewBot = true;
        }
      }
    }
    if (hasNewBot) {
      store.bots = botsMap;
      writeBotStore(store);
    }
  }

  return Object.values(botsMap).map(formatBotRecord).filter(Boolean);
}

export function getBotByIdOrToken(identifier = null) {
  const all = getConnectedBots();
  if (!identifier) {
    return all.find(b => b.status === 'active' && b.isPrimary) ||
           all.find(b => b.status === 'active') ||
           all[0] ||
           null;
  }
  const clean = String(identifier).trim().toLowerCase();
  return all.find(b => 
    b.botId.toLowerCase() === clean || 
    b.id === clean || 
    b.token === clean || 
    b.username.toLowerCase() === clean.replace('@', '')
  ) || null;
}

export async function saveConnectedBot(botData) {
  // Sync remote first to avoid wiping other fleet bots
  await syncBotsFromSupabase(true).catch(() => {});

  const store = readBotStore();
  if (!store.bots) store.bots = {};
  const formatted = formatBotRecord(botData);
  if (!formatted || !formatted.token) throw new Error('Invalid bot data or token missing');
  store.bots[formatted.botId] = formatted;
  if (formatted.isPrimary || Object.keys(store.bots).length === 1) {
    store.activeToken = formatted.token;
    store.bot = {
      username: formatted.username,
      name: formatted.name,
      id: formatted.id,
      source: 'database',
      lastActivatedAt: formatted.lastActivatedAt
    };
  }
  writeBotStore(store);
  cachedBotConfig = null;

  // Guaranteed AWAIT for Supabase persistence
  await syncBotsToSupabase(store.bots);

  return formatted;
}

export async function removeConnectedBot(botId) {
  await syncBotsFromSupabase(true).catch(() => {});
  const store = readBotStore();
  if (!store.bots) return false;
  const target = getBotByIdOrToken(botId);
  if (!target) throw new Error('Bot not found');
  
  try {
    await callTelegram('deleteWebhook', { drop_pending_updates: false }, target.token);
  } catch (_) {}

  delete store.bots[target.botId];
  writeBotStore(store);
  cachedBotConfig = null;

  await syncBotsToSupabase(store.bots);
  return true;
}

export async function toggleBotStatus(botId, newStatus, notifyUsers = false, noticeMessage = '') {
  await syncBotsFromSupabase(true).catch(() => {});
  const store = readBotStore();
  const target = getBotByIdOrToken(botId);
  if (!target) throw new Error('Bot not found');

  target.status = newStatus === 'inactive' ? 'inactive' : 'active';
  target.lastActivatedAt = new Date().toISOString();
  store.bots[target.botId] = target;
  writeBotStore(store);
  cachedBotConfig = null;

  if (target.status === 'active') {
    const appUrl = getAppUrl();
    const webhookUrl = `${appUrl}/api/telegram/bot?botId=${target.botId}`;
    try {
      await callTelegram('setWebhook', {
        url: webhookUrl,
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query']
      }, target.token);
      const storeWebUrl = `${appUrl}?botId=${target.botId}&botUser=${encodeURIComponent(target.username || '')}`;
      await callTelegram('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: '🛍️ Open Store',
          web_app: { url: storeWebUrl }
        }
      }, target.token).catch(() => {});
    } catch (_) {}
  }

  let sentNoticeCount = 0;
  if (notifyUsers && noticeMessage && noticeMessage.trim()) {
    try {
      const allUsers = await getAllBotUsers();
      const targetUsers = allUsers.filter(u => u && doesUserBelongToFleetBot(u, target));
      for (const user of targetUsers) {
        if (!user.id) continue;
        try {
          await callTelegram('sendMessage', {
            chat_id: user.id,
            text: noticeMessage.trim(),
            parse_mode: 'HTML'
          }, target.token);
          sentNoticeCount++;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 45));
      }
    } catch (_) {}
  }

  await syncBotsToSupabase(store.bots);
  return { ok: true, bot: target, sentNoticeCount };
}

export async function addAdminChatId(chatId, label = '', assignedBotId = 'all', assignedBotUsername = 'All Fleet Bots') {
  const cleanId = String(chatId || '').replace(/[^0-9-]/g, '').trim();
  if (!cleanId || cleanId.length < 5) {
    throw new Error('Invalid Telegram Chat ID. Chat IDs are 8-10 digit numbers.');
  }
  const store = readBotStore();
  if (!Array.isArray(store.admins)) store.admins = [...DEFAULT_ADMIN_IDS];
  if (!store.admins.includes(cleanId)) {
    store.admins.push(cleanId);
  }
  if (!store.adminProfiles) store.adminProfiles = {};

  // Auto-fetch real Telegram First Name & Username via getChat API across all fleet bots
  let tgFirstName = '';
  let tgLastName = '';
  let tgUsername = '';
  const allFleetBots = getConnectedBots();
  for (const b of allFleetBots) {
    if (!b.token) continue;
    try {
      const chatInfo = await callTelegram('getChat', { chat_id: cleanId }, b.token);
      if (chatInfo && chatInfo.ok && chatInfo.result) {
        tgFirstName = chatInfo.result.first_name || '';
        tgLastName = chatInfo.result.last_name || '';
        tgUsername = (chatInfo.result.username || '').replace('@', '');
        if (tgFirstName || tgUsername) break;
      }
    } catch (_) {}
  }

  // Fallback to store.users or Supabase tg_bot_users if user interacted with bot
  if (!tgFirstName && !tgUsername) {
    let u = store.users?.[cleanId];
    if (!u) {
      try {
        const { url, key } = getSupabaseConfig();
        const sbRes = await fetch(`${url}/rest/v1/site_settings?key=eq.tg_bot_users`, {
          headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
        });
        if (sbRes.ok) {
          const rows = await sbRes.json();
          u = rows?.[0]?.value?.[cleanId];
        }
      } catch (_) {}
    }
    if (u) {
      tgFirstName = u.firstName || '';
      tgLastName = u.lastName || '';
      tgUsername = (u.username || '').replace('@', '');
    }
  }

  const resolvedName = [tgFirstName, tgLastName].filter(Boolean).join(' ').trim() || label || `Admin #${cleanId}`;
  store.adminProfiles[cleanId] = {
    id: cleanId,
    name: resolvedName,
    username: tgUsername || '',
    badge: '🛡️ ADMIN',
    assignedBotId: assignedBotId || 'all',
    assignedBotUsername: assignedBotUsername || 'All Fleet Bots',
    role: assignedBotId && assignedBotId !== 'all' ? `Admin for @${assignedBotUsername || assignedBotId}` : 'Order Proof Alerts & Instant Approve/Reject Buttons Across All Bots',
    updatedAt: Date.now()
  };

  writeBotStore(store);

  let welcomeSent = false;
  try {
    const res = await callTelegram('sendMessage', {
      chat_id: cleanId,
      text: `👑 <b>Administrator Connected!</b>\n\n` +
            `Hello <b>${escapeTelegramHtml(resolvedName)}</b>,\n` +
            `You have been connected as an Administrator for <b>LinkAdda Online</b>.\n` +
            `You will now receive realtime order notifications, payment screenshots, and approval alerts directly here!`,
      parse_mode: 'HTML'
    });
    welcomeSent = Boolean(res?.ok);
  } catch (_) {}

  (async () => {
    try {
      const { url, key } = getSupabaseConfig();
      await fetch(`${url}/rest/v1/site_settings`, {
        method: 'POST',
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([
          { key: 'tg_admin_chat_ids', value: store.admins, updated_at: new Date().toISOString() },
          { key: 'tg_admin_profiles', value: store.adminProfiles, updated_at: new Date().toISOString() }
        ])
      });
    } catch (_) {}
  })();

  return { ok: true, admins: getAdminChatIds(), adminProfiles: store.adminProfiles, admin: store.adminProfiles[cleanId], welcomeSent };
}

export async function removeAdminChatId(chatId) {
  const cleanId = String(chatId || '').trim();
  const store = readBotStore();
  if (Array.isArray(store.admins)) {
    store.admins = store.admins.filter(id => String(id).trim() !== cleanId);
    if (store.adminProfiles && store.adminProfiles[cleanId]) {
      delete store.adminProfiles[cleanId];
    }
    writeBotStore(store);
  }

  (async () => {
    try {
      const { url, key } = getSupabaseConfig();
      await fetch(`${url}/rest/v1/site_settings`, {
        method: 'POST',
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([
          { key: 'tg_admin_chat_ids', value: store.admins, updated_at: new Date().toISOString() },
          { key: 'tg_admin_profiles', value: store.adminProfiles || {}, updated_at: new Date().toISOString() }
        ])
      });
    } catch (_) {}
  })();

  return { ok: true, admins: getAdminChatIds(), adminProfiles: store.adminProfiles || {} };
}

// In-memory cache for ultra-speed active bot config
let cachedBotConfig = null;
let lastBotCacheFetch = 0;
const BOT_CACHE_TTL_MS = 5000;
let _cachedWebhookData = null;
let _cachedWebhookDataTime = 0;

/**
 * Fetch currently active bot token instantly (<0.1ms) from local store
 */
export async function getActiveBotConfig(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedBotConfig && (now - lastBotCacheFetch < BOT_CACHE_TTL_MS)) {
    return cachedBotConfig;
  }

  const primaryBot = getBotByIdOrToken();
  const token = (primaryBot?.token || process.env.TELEGRAM_BOT_TOKEN || '8923608774:AAFhvO4Yzly7toIf5qoI-TSW4EzVzWCdVlE').trim();

  cachedBotConfig = {
    token,
    username: primaryBot?.username || 'Myshop9876_bot',
    name: primaryBot?.name || 'LinkAdda Store Bot',
    botId: String(primaryBot?.id || '8923608774'),
    source: 'multi_bot_store',
    lastActivatedAt: primaryBot?.lastActivatedAt || null,
    updatedAt: now
  };
  lastBotCacheFetch = now;
  return cachedBotConfig;
}

/**
 * Call official Telegram Bot API with FormData multipart & JSON support
 */
export async function callTelegram(method, body = {}, overrideToken = null) {
  try {
    let token = overrideToken;
    if (!token) {
      const cfg = await getActiveBotConfig();
      token = cfg.token;
    }
    const isFormData = (typeof FormData !== 'undefined') && (body instanceof FormData);
    const timeoutMs = isFormData ? 25000 : 10000;
    const fetchOptions = {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs)
    };
    if (isFormData) {
      // Native fetch automatically provides multipart boundary header
      fetchOptions.body = body;
    } else {
      fetchOptions.headers = { 'Content-Type': 'application/json' };
      fetchOptions.body = JSON.stringify(body);
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, fetchOptions);
    return await res.json();
  } catch (err) {
    console.error(`Telegram API error [${method}]:`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Switch & Activate a new Telegram Bot instantly (Zero Lag Hot-Swap)
 */
export async function switchTelegramBot(newToken, adminUser = 'Admin Panel', req = null) {
  if (!newToken || typeof newToken !== 'string' || newToken.trim().length < 15) {
    return { ok: false, error: 'Please enter a valid Telegram Bot Token from @BotFather.' };
  }
  const cleanToken = newToken.trim();

  // 1. Verify token with Telegram getMe (timeout 5s)
  const meRes = await callTelegram('getMe', {}, cleanToken);
  if (!meRes || !meRes.ok || !meRes.result) {
    return { 
      ok: false, 
      error: 'Invalid Bot Token! Telegram returned: ' + (meRes?.description || 'Unauthorized token') 
    };
  }

  const botUser = meRes.result;
  const rawId = String(botUser.id || '');
  const botId = `bot_${rawId}`;
  const appUrl = getAppUrl(req);
  const webhookUrl = `${appUrl}/api/telegram/bot?botId=${botId}`;

  // 2. Set Webhook on Telegram for this bot with dedicated botId routing
  let hookRes = null;
  let webhookWarning = null;
  try {
    hookRes = await callTelegram('setWebhook', {
      url: webhookUrl,
      drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query']
    }, cleanToken);

    if (!hookRes || !hookRes.ok) {
      webhookWarning = hookRes?.description || 'Telegram setWebhook returned warning';
      console.warn('Telegram setWebhook warning on switch:', webhookWarning);
    }
  } catch (err) {
    webhookWarning = err.message;
  }

  // 3. Set WebApp Menu Button ("Open Store") with exact bot binding
  const storeWebUrl = `${appUrl}?botId=${botId}&botUser=${encodeURIComponent(botUser.username || '')}`;
  await callTelegram('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: '🛍️ Open Store',
      web_app: { url: storeWebUrl }
    }
  }, cleanToken).catch(() => {});

  // 4. Set Default Bot Commands
  await callTelegram('setMyCommands', {
    commands: [
      { command: 'start', description: 'Start Store & Open VIP Collections' },
      { command: 'help', description: '24/7 VIP Customer Support' }
    ]
  }, cleanToken).catch(() => {});

  // 5. Instantly persist to local bot_store.json (0ms lag) & fleet registry
  const store = readBotStore();
  if (!store.bots) store.bots = {};
  store.activeToken = cleanToken;
  store.bot = {
    username: botUser.username || '',
    name: botUser.first_name || '',
    id: rawId,
    source: 'hot_swap',
    lastActivatedAt: new Date().toISOString(),
    activatedBy: adminUser
  };
  store.bots[botId] = {
    id: rawId,
    botId,
    token: cleanToken,
    username: botUser.username || '',
    name: botUser.first_name || 'LinkAdda Bot',
    status: 'active',
    isPrimary: true,
    createdAt: store.bots[botId]?.createdAt || Date.now(),
    lastActivatedAt: new Date().toISOString()
  };
  // Ensure only this bot is marked isPrimary across fleet
  Object.values(store.bots).forEach(b => {
    if (b.botId !== botId) b.isPrimary = false;
  });
  writeBotStore(store);

  // 6. Update in-memory cache
  cachedBotConfig = {
    token: cleanToken,
    username: botUser.username || '',
    name: botUser.first_name || '',
    botId: botId,
    source: 'hot_swap',
    lastActivatedAt: Date.now(),
    updatedAt: Date.now()
  };
  lastBotCacheFetch = Date.now();

  // Non-blocking sync to Supabase site_settings for fleet and telegram_bot
  syncBotsToSupabase(store.bots).catch(() => {});

  // 7. Non-blocking async backup to Supabase (1.5s timeout)
  (async () => {
    try {
      const { url, key } = getSupabaseConfig();
      const headers = { 
        'apikey': key, 
        'Authorization': `Bearer ${key}`, 
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      };
      await fetch(`${url}/rest/v1/site_settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify([{
          key: 'telegram_bot',
          value: {
            botToken: cleanToken,
            botUsername: botUser.username || '',
            botName: botUser.first_name || '',
            botId: String(botUser.id || ''),
            webhookUrl,
            status: 'active',
            lastActivatedAt: Date.now(),
            activatedBy: adminUser
          },
          updated_at: new Date().toISOString()
        }]),
        signal: AbortSignal.timeout(1500)
      });
    } catch (_) {}
  })();

  // 8. Send notification alert to Admin chat IDs via the new bot
  const adminIds = getAdminChatIds();
  for (const adminId of adminIds) {
    callTelegram('sendMessage', {
      chat_id: adminId,
      text: 
        `🤖 <b>Telegram Bot Switched Successfully!</b>\n\n` +
        `✅ <b>Active Bot:</b> @${botUser.username}\n` +
        `🏷️ <b>Bot Name:</b> ${botUser.first_name}\n` +
        `🆔 <b>Bot ID:</b> <code>${botUser.id}</code>\n` +
        `🔗 <b>Webhook:</b> <code>${webhookUrl}</code>\n` +
        `👤 <b>Switched By:</b> ${adminUser}\n\n` +
        `This bot is now actively receiving orders, alerts, and processing approvals!`,
      parse_mode: 'HTML'
    }, cleanToken).catch(() => {});
  }

  const maskedToken = `${cleanToken.slice(0, 6)}...${cleanToken.slice(-4)}`;

  return {
    ok: true,
    bot: {
      username: botUser.username || '',
      name: botUser.first_name || '',
      id: String(botUser.id || ''),
      source: 'hot_swap',
      maskedToken,
      lastActivatedAt: Date.now()
    },
    webhook: hookRes?.result || hookRes || { url: webhookUrl, pending_update_count: 0 },
    webhookWarning,
    message: webhookWarning 
      ? `Bot @${botUser.username} activated! (Note: Webhook notice: ${webhookWarning})` 
      : `Bot @${botUser.username} successfully activated and linked!`
  };
}

/**
 * Helper to check if a Telegram user belongs to a specific bot in the fleet.
 * Completely preserves multi-bot enrollment!
 */
export function doesUserBelongToFleetBot(u, b, fleet = []) {
  if (!u || !b) return false;
  const bId = String(b.botId || `bot_${b.id}` || b.id || '').trim();
  const bRawId = String(b.id || '').trim();
  const bUname = String(b.username || '').replace(/^@/, '').toLowerCase().trim();

  // 1. Check user.bots dictionary
  if (u.bots && typeof u.bots === 'object') {
    if (u.bots[bId] || (bRawId && u.bots[`bot_${bRawId}`]) || (bRawId && u.bots[bRawId])) return true;
    if (bUname && (u.bots[bUname] || u.bots[`@${bUname}`])) return true;
    for (const [k, v] of Object.entries(u.bots)) {
      if (k === bId || k === bRawId || k === `bot_${bRawId}` || (bUname && k.toLowerCase() === bUname)) return true;
      if (v && ((v.botId && (v.botId === bId || v.botId === bRawId || v.botId === `bot_${bRawId}`)) ||
                (v.username && v.username.toLowerCase() === bUname) ||
                (v.botUsername && v.botUsername.toLowerCase() === bUname))) {
        return true;
      }
    }
  }

  // 2. Check sourceBotIds array
  if (Array.isArray(u.sourceBotIds)) {
    if (u.sourceBotIds.includes(bId) || (bRawId && u.sourceBotIds.includes(bRawId)) || (bRawId && u.sourceBotIds.includes(`bot_${bRawId}`))) return true;
    if (bUname && u.sourceBotIds.some(x => String(x).toLowerCase() === bUname)) return true;
  }

  // 3. Check scalar sourceBotId or lastBotId
  const uBotId = String(u.sourceBotId || u.lastBotId || '');
  if (uBotId && (uBotId === bId || uBotId === bRawId || (bRawId && uBotId === `bot_${bRawId}`))) return true;

  // 4. Check scalar sourceBotUsername
  const uBotUname = String(u.sourceBotUsername || '').replace(/^@/, '').toLowerCase();
  if (uBotUname && bUname && uBotUname === bUname) return true;

  // 5. Fallback ONLY if user has completely zero bot records anywhere and only 1 bot exists in fleet
  const hasAnyBots = (u.bots && Object.keys(u.bots).length > 0) || (u.sourceBotIds && u.sourceBotIds.length > 0) || u.sourceBotId;
  if (!hasAnyBots && fleet && fleet.length === 1) return true;

  return false;
}

/**
 * Record and sync a telegram user interaction in local JSON and Supabase site_settings
 * Supports users belonging to MULTIPLE bots simultaneously!
 */
export async function recordBotUser(fromUser, source = 'bot_interaction', sourceBotId = null) {
  if (!fromUser?.id) return;
  const uidStr = String(fromUser.id);
  const adminIds = new Set(getAdminChatIds());
  const isAdmin = adminIds.has(uidStr);

  const store = readBotStore();
  if (!store.users) store.users = {};

  const existingLocal = store.users[uidStr] || {};
  const cleanUsername = String(fromUser.username || existingLocal.username || '').replace('@', '').trim();
  const rawFirstName = fromUser.first_name || fromUser.firstName || existingLocal.firstName || '';
  const cleanFirstName = String(rawFirstName).replace(/^undefined$/i, '').trim() || (cleanUsername ? cleanUsername : `User #${uidStr}`);
  const cleanLastName = String(fromUser.last_name || fromUser.lastName || existingLocal.lastName || '').replace(/^undefined$/i, '').trim();

  // Multi-bot mapping: strictly resolve the exact bot this user interacted with (NO blind fallback to Bot 1!)
  await syncBotsFromSupabase().catch(() => {});
  let allBots = getConnectedBots();
  const explicitBotId = sourceBotId || fromUser?.botId || fromUser?.source_bot_id || fromUser?.sourceBotId || null;
  let currentBot = null;
  if (explicitBotId) {
    const cleanId = String(explicitBotId).toLowerCase().replace('@', '');
    currentBot = allBots.find(b => b.botId.toLowerCase() === cleanId || b.id === cleanId || (b.username && b.username.toLowerCase() === cleanId));
    if (!currentBot) {
      await syncBotsFromSupabase(true).catch(() => {});
      allBots = getConnectedBots();
      currentBot = allBots.find(b => b.botId.toLowerCase() === cleanId || b.id === cleanId || (b.username && b.username.toLowerCase() === cleanId));
    }
    if (!currentBot) {
      const bId = String(explicitBotId).startsWith('bot_') ? String(explicitBotId) : `bot_${explicitBotId}`;
      currentBot = { botId: bId, username: '' };
    }
  }

  const targetBot = currentBot || (existingLocal.sourceBotId ? allBots.find(b => b.botId === existingLocal.sourceBotId) : null);
  const currentBotId = targetBot ? targetBot.botId : null;
  const currentBotUsername = targetBot ? (targetBot.username || '') : '';

  // 1. Fetch remote users from Supabase FIRST so we NEVER overwrite historical bot memberships!
  const { url, key } = getSupabaseConfig();
  const headers = { 
    'apikey': key, 
    'Authorization': `Bearer ${key}`, 
    'Content-Type': 'application/json' 
  };

  let remoteUsers = {};
  try {
    const getRes = await fetch(`${url}/rest/v1/site_settings?key=eq.tg_bot_users&select=value`, {
      headers,
      signal: AbortSignal.timeout(3500)
    });
    if (getRes.ok) {
      const rows = await getRes.json();
      if (rows && rows[0] && rows[0].value && typeof rows[0].value === 'object') {
        remoteUsers = rows[0].value;
      }
    }
  } catch (err) {
    console.warn('recordBotUser remote fetch note:', err.message);
  }

  const existingRemote = remoteUsers[uidStr] || {};

  // 2. Deep-merge all bot associations across Remote, Local, and Current Bot
  const combinedBots = {
    ...(existingRemote.bots || {}),
    ...(existingLocal.bots || {})
  };

  // Preserve any previously known single-bot association from remote
  if (existingRemote.sourceBotId && !combinedBots[existingRemote.sourceBotId]) {
    const bMatch = allBots.find(b => b.botId === existingRemote.sourceBotId || b.id === existingRemote.sourceBotId);
    combinedBots[existingRemote.sourceBotId] = {
      botId: existingRemote.sourceBotId,
      botUsername: bMatch?.username || existingRemote.sourceBotUsername || existingRemote.sourceBotId.replace(/^bot_/, ''),
      joinedAt: existingRemote.createdAt || Date.now(),
      lastActiveAt: existingRemote.updatedAt || Date.now(),
      source: existingRemote.source || 'bot_start'
    };
  }

  // Preserve any previously known single-bot association from local
  if (existingLocal.sourceBotId && !combinedBots[existingLocal.sourceBotId]) {
    const bMatch = allBots.find(b => b.botId === existingLocal.sourceBotId || b.id === existingLocal.sourceBotId);
    combinedBots[existingLocal.sourceBotId] = {
      botId: existingLocal.sourceBotId,
      botUsername: bMatch?.username || existingLocal.sourceBotUsername || existingLocal.sourceBotId.replace(/^bot_/, ''),
      joinedAt: existingLocal.createdAt || Date.now(),
      lastActiveAt: existingLocal.updatedAt || Date.now(),
      source: existingLocal.source || 'bot_start'
    };
  }

  // Add or update current bot interaction
  if (currentBotId) {
    const prevEntry = combinedBots[currentBotId] || {};
    combinedBots[currentBotId] = {
      botId: currentBotId,
      botUsername: currentBotUsername || prevEntry.botUsername || currentBotId.replace(/^bot_/, ''),
      joinedAt: prevEntry.joinedAt || Date.now(),
      lastActiveAt: Date.now(),
      source: source || prevEntry.source || 'bot_start'
    };
  }

  const allBotIds = Object.keys(combinedBots);
  const recordedBotId = currentBotId || existingRemote.sourceBotId || existingLocal.sourceBotId || (allBotIds.length ? allBotIds[0] : null);
  const recordedBotUname = currentBotUsername || existingRemote.sourceBotUsername || existingLocal.sourceBotUsername || '';

  const userObj = {
    id: uidStr,
    username: cleanUsername || existingRemote.username || '',
    firstName: cleanFirstName || existingRemote.firstName || 'Telegram User',
    lastName: cleanLastName || existingRemote.lastName || '',
    source: isAdmin ? 'admin_tester' : (source || existingLocal.source || existingRemote.source || 'bot_start'),
    sourceBotId: recordedBotId,
    sourceBotUsername: recordedBotUname,
    lastBotId: currentBotId || existingLocal.lastBotId || existingRemote.lastBotId || recordedBotId,
    bots: combinedBots,
    sourceBotIds: allBotIds,
    isAdmin,
    createdAt: existingRemote.createdAt || existingLocal.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  // 3. Merge full directories together so NO user and NO bot is EVER dropped
  let mergedUsers = { ...remoteUsers, ...store.users };
  for (const [k, v] of Object.entries(remoteUsers)) {
    if (v && v.id) {
      if (mergedUsers[k]) {
        mergedUsers[k].bots = { ...(v.bots || {}), ...(mergedUsers[k].bots || {}) };
        mergedUsers[k].sourceBotIds = Object.keys(mergedUsers[k].bots);
      } else {
        mergedUsers[k] = v;
      }
    }
  }

  // Set the freshly updated user record (with all bots preserved!)
  mergedUsers[uidStr] = userObj;
  store.users = mergedUsers;

  // Re-calculate subscriber count across all connected bots (Admins strictly excluded)
  if (store.bots && typeof store.bots === 'object') {
    const allUsersList = Object.values(store.users).filter(u => {
      if (!u || !u.id) return false;
      const uid = String(u.id);
      if (adminIds.has(uid) || adminIds.has(String(u.id).replace('@', ''))) return false;
      if (u.isAdmin || u.source === 'admin_account' || u.source === 'admin_tester') return false;
      return true;
    });
    for (const bKey of Object.keys(store.bots)) {
      const bObj = store.bots[bKey];
      if (!bObj) continue;
      bObj.subscribersCount = allUsersList.filter(u => doesUserBelongToFleetBot(u, bObj, allBots)).length;
    }
  }

  writeBotStore(store);

  // 4. Persist to Supabase site_settings
  try {
    await fetch(`${url}/rest/v1/site_settings`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([{ key: 'tg_bot_users', value: mergedUsers, updated_at: new Date().toISOString() }]),
      signal: AbortSignal.timeout(4000)
    });
  } catch (err) {
    console.warn('recordBotUser Supabase write note:', err.message);
  }
}

/**
 * Fetch all real registered bot subscribers (Admins strictly filtered out)
 * Unifies local cache, Supabase site_settings, and all Telegram customers from Orders!
 */
export async function getAllBotUsers() {
  try {
    // 1. Force sync bot fleet from Supabase so allBots is 100% up to date
    await syncBotsFromSupabase(true).catch(() => {});

    const store = readBotStore();
    const adminIds = new Set(getAdminChatIds());
    let usersMap = { ...(store.users || {}) };

    // Fetch live users from Supabase (site_settings + orders) to ensure 100% persistence across Render restarts
    try {
      const { url, key } = getSupabaseConfig();
      const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

      // 1. Fetch site_settings -> tg_bot_users
      // 2. Discover all customers from orders table who provided Telegram User ID / Username (only query existing columns: id, order_id, created_at, status, data)
      const [settingsRes, ordersRes] = await Promise.all([
        fetch(`${url}/rest/v1/site_settings?key=eq.tg_bot_users&select=*`, { headers, signal: AbortSignal.timeout(4500) }).catch(() => null),
        fetch(`${url}/rest/v1/orders?select=id,order_id,created_at,status,data&order=created_at.desc&limit=500`, { headers, signal: AbortSignal.timeout(4500) }).catch(() => null)
      ]);

      if (settingsRes && settingsRes.ok) {
        const rows = await settingsRes.json();
        if (rows && rows[0] && rows[0].value && typeof rows[0].value === 'object') {
          // Supabase is authoritative! Merge bots maps so multiple bot associations are preserved
          for (const [k, v] of Object.entries(rows[0].value)) {
            if (v && v.id) {
              if (usersMap[k]) {
                usersMap[k] = {
                  ...usersMap[k],
                  ...v,
                  bots: { ...(usersMap[k].bots || {}), ...(v.bots || {}) }
                };
                usersMap[k].sourceBotIds = Object.keys(usersMap[k].bots);
              } else {
                usersMap[k] = v;
              }
            }
          }
        }
      }

      if (ordersRes && ordersRes.ok) {
        const orders = await ordersRes.json();
        if (Array.isArray(orders)) {
          for (const ord of orders) {
            const data = ord.data || {};
            const rawId = data.telegramUserId || data.telegram_user_id || data.telegramId || ord.telegram_user_id || '';
            const tgId = String(rawId).trim();
            const tgUser = (data.telegramUsername || data.telegram || '').replace('@', '').trim();
            const rawEmail = ord.customer_email || data.customerEmail || data.email || '';
            const rawCustName = ord.customer_name || data.customerName || data.name || data.firstName || '';
            const email = String(rawEmail).trim().toLowerCase();
            const custName = String(rawCustName).replace(/^undefined$/i, '').trim() || (tgUser ? `@${tgUser}` : (email ? email.split('@')[0] : 'Telegram Customer'));
            const hasValidTgId = tgId && tgId !== 'undefined' && tgId !== 'null';
            const ordBotId = ord.source_bot_id || data.sourceBotId || data.source_bot_id || data.botId || null;
            const ordBotUname = ord.source_bot_username || data.sourceBotUsername || data.source_bot_username || data.botUser || null;
            const matchedFleetBot = ordBotId ? (allBots.find(b => b.botId === ordBotId || b.id === ordBotId || (b.username && b.username.toLowerCase() === ordBotId.toLowerCase()))) : null;
            const resolvedBotId = matchedFleetBot ? matchedFleetBot.botId : (ordBotId ? (String(ordBotId).startsWith('bot_') ? ordBotId : `bot_${ordBotId}`) : null);
            const resolvedBotUname = matchedFleetBot ? matchedFleetBot.username : (ordBotUname || (resolvedBotId ? resolvedBotId.replace(/^bot_/, '') : ''));

            // Only capture REAL telegram users (with a numeric tgId or valid @username)
            if (hasValidTgId || tgUser) {
              const userKey = hasValidTgId ? tgId : `tg_${tgUser}`;
              const bMap = resolvedBotId ? { [resolvedBotId]: { botId: resolvedBotId, botUsername: resolvedBotUname, joinedAt: new Date(ord.created_at || Date.now()).getTime(), source: 'order_checkout' } } : {};
              if (!usersMap[userKey]) {
                usersMap[userKey] = {
                  id: hasValidTgId ? tgId : `@${tgUser}`,
                  username: tgUser,
                  firstName: custName,
                  lastName: '',
                  source: 'order_checkout',
                  sourceBotId: resolvedBotId,
                  sourceBotUsername: resolvedBotUname,
                  bots: bMap,
                  sourceBotIds: Object.keys(bMap),
                  createdAt: new Date(ord.created_at || Date.now()).getTime(),
                  updatedAt: new Date(ord.created_at || Date.now()).getTime()
                };
              } else if (resolvedBotId && usersMap[userKey]) {
                if (!usersMap[userKey].bots) usersMap[userKey].bots = {};
                usersMap[userKey].bots[resolvedBotId] = { botId: resolvedBotId, botUsername: resolvedBotUname, joinedAt: new Date(ord.created_at || Date.now()).getTime(), source: 'order_checkout' };
                usersMap[userKey].sourceBotIds = Object.keys(usersMap[userKey].bots);
                usersMap[userKey].lastBotId = resolvedBotId;
                if (!usersMap[userKey].sourceBotId) usersMap[userKey].sourceBotId = resolvedBotId;
              }
            }
          }
        }
      }

      // Sync unified list back to local cache & Supabase
      store.users = usersMap;
      writeBotStore(store);

      // Async backup unified directory to Supabase site_settings
      fetch(`${url}/rest/v1/site_settings`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify([{ key: 'tg_bot_users', value: usersMap, updated_at: new Date().toISOString() }]),
        signal: AbortSignal.timeout(3000)
      }).catch(() => {});
    } catch (sbErr) {
      console.warn('getAllBotUsers Supabase live fetch note:', sbErr.message);
    }

    const allBots = getConnectedBots();
    const primaryBot = allBots.find(b => b.isPrimary) || allBots[0] || { botId: 'bot_8923608774', username: 'Myshop9876_bot' };

    const users = Object.values(usersMap).filter(u => {
      if (!u || !u.id) return false;
      const uid = String(u.id);
      if (adminIds.has(uid) || adminIds.has(String(u.id).replace('@', ''))) return false;
      if (u.isAdmin || u.source === 'admin_account' || u.source === 'admin_tester') return false;
      return true;
    }).map(u => {
      // Deeply enrich all bots this user belongs to
      const enrichedBots = {};
      if (u.bots && typeof u.bots === 'object') {
        for (const [bKey, bVal] of Object.entries(u.bots)) {
          const matchedBot = allBots.find(b => b.botId === bKey || b.id === bKey || (b.username && b.username.toLowerCase() === bKey.toLowerCase()));
          const canonId = matchedBot ? matchedBot.botId : bKey;
          const canonUname = matchedBot ? matchedBot.username : (bVal?.botUsername || bVal?.username || bKey.replace(/^bot_/, ''));
          enrichedBots[canonId] = {
            botId: canonId,
            botUsername: canonUname,
            joinedAt: bVal?.joinedAt || u.createdAt || Date.now(),
            source: bVal?.source || u.source || 'bot_start'
          };
        }
      }

      // Check sourceBotIds list
      if (Array.isArray(u.sourceBotIds)) {
        u.sourceBotIds.forEach(id => {
          const matchedBot = allBots.find(b => b.botId === id || b.id === id);
          if (matchedBot && !enrichedBots[matchedBot.botId]) {
            enrichedBots[matchedBot.botId] = {
              botId: matchedBot.botId,
              botUsername: matchedBot.username,
              joinedAt: u.createdAt || Date.now(),
              source: u.source || 'bot_start'
            };
          }
        });
      }

      // If user has scalar sourceBotId or sourceBotUsername
      if (u.sourceBotId) {
        const cleanS = String(u.sourceBotId).toLowerCase().replace('@', '');
        const matched = allBots.find(b => b.botId.toLowerCase() === cleanS || b.id === cleanS || (b.username && b.username.toLowerCase() === cleanS));
        const canonId = matched ? matched.botId : (String(u.sourceBotId).startsWith('bot_') ? String(u.sourceBotId) : `bot_${u.sourceBotId}`);
        const canonUname = matched ? matched.username : (u.sourceBotUsername || canonId.replace(/^bot_/, ''));
        if (!enrichedBots[canonId]) {
          enrichedBots[canonId] = {
            botId: canonId,
            botUsername: canonUname,
            joinedAt: u.createdAt || Date.now(),
            source: u.source || 'bot_start'
          };
        }
      }

      const sId = u.lastBotId || u.sourceBotId || Object.keys(enrichedBots)[0] || null;
      const bMatch = sId ? (allBots.find(b => b.botId === sId || b.id === sId) || null) : null;

      return {
        ...u,
        sourceBotId: sId,
        sourceBotUsername: u.sourceBotUsername || bMatch?.username || (sId ? sId.replace(/^bot_/, '') : null),
        bots: enrichedBots,
        sourceBotIds: Object.keys(enrichedBots)
      };
    });
    return users.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  } catch (err) {
    console.error('getAllBotUsers error:', err);
    return [];
  }
}

/**
 * ── SMART 2-MINUTE READ / 3-HOUR SAFETY AUTO-DELETE ENGINE ──────────────────────
 */

/**
 * Register a message in the persistent pendingDeletions queue
 * Default TTL: 3 Hours (10800 seconds) if unread.
 */
export function queueMessageForDeletion(chatId, messageId, meta = {}) {
  if (!chatId || !messageId) return;
  try {
    const store = readBotStore();
    if (!store.pendingDeletions) store.pendingDeletions = {};

    const key = `${chatId}_${messageId}`;
    const now = Date.now();
    const maxTtlMs = 3 * 60 * 60 * 1000; // 3 hours

    store.pendingDeletions[key] = {
      chatId: String(chatId),
      messageId: Number(messageId),
      orderId: meta.orderId ? String(meta.orderId) : null,
      productTitle: meta.productTitle || '',
      sentAt: now,
      deleteAt: now + maxTtlMs, // 3 hours from now if unread
      status: 'unread',
      readAt: null
    };

    writeBotStore(store);

    // Schedule check in memory
    setTimeout(() => {
      checkAndExecuteSingleDeletion(key).catch(() => {});
    }, maxTtlMs);
  } catch (err) {
    console.warn('queueMessageForDeletion error:', err.message);
  }
}

/**
 * Triggered when user reads/views the message or becomes active in the chat
 * Switches delete timer to exactly 2 Minutes (120 seconds)!
 */
export function markUserMessagesAsRead(chatId, specificOrderId = null) {
  if (!chatId) return [];
  try {
    const store = readBotStore();
    if (!store.pendingDeletions) return [];

    const now = Date.now();
    const twoMinutesMs = 2 * 60 * 1000; // 2 minutes (120s)
    const modifiedKeys = [];

    for (const [key, item] of Object.entries(store.pendingDeletions)) {
      if (String(item.chatId) === String(chatId)) {
        if (specificOrderId && item.orderId && String(item.orderId) !== String(specificOrderId)) {
          continue;
        }
        if (item.status === 'unread') {
          item.status = 'read';
          item.readAt = now;
          // Set to expire exactly 2 minutes from the moment of read
          item.deleteAt = now + twoMinutesMs;
          modifiedKeys.push(key);

          // Direct timer for 120 seconds
          setTimeout(() => {
            checkAndExecuteSingleDeletion(key).catch(() => {});
          }, twoMinutesMs);
        }
      }
    }

    if (modifiedKeys.length > 0) {
      writeBotStore(store);
      console.log(`[Auto-Delete] Marked ${modifiedKeys.length} messages as READ for user ${chatId}. Auto-delete in 2 minutes.`);
    }

    return modifiedKeys;
  } catch (err) {
    console.warn('markUserMessagesAsRead error:', err.message);
    return [];
  }
}

/**
 * Execute deletion for a single queued message
 */
async function checkAndExecuteSingleDeletion(key) {
  try {
    const store = readBotStore();
    if (!store.pendingDeletions || !store.pendingDeletions[key]) return;

    const item = store.pendingDeletions[key];
    if (Date.now() >= item.deleteAt - 1000) {
      try {
        await callTelegram('deleteMessage', {
          chat_id: item.chatId,
          message_id: item.messageId
        });
        console.log(`[Auto-Delete] Deleted message #${item.messageId} in chat ${item.chatId} (status: ${item.status})`);
      } catch (err) {
        console.warn(`[Auto-Delete] Message #${item.messageId} deletion notice:`, err.message);
      }
      delete store.pendingDeletions[key];
      writeBotStore(store);
    }
  } catch (e) {
    console.warn('checkAndExecuteSingleDeletion error:', e.message);
  }
}

/**
 * Periodic cleanup worker (runs every 15s) to guarantee no deletion is missed even across restarts
 */
export async function processPendingDeletions() {
  try {
    const store = readBotStore();
    if (!store.pendingDeletions) return;

    const now = Date.now();
    let changed = false;

    for (const [key, item] of Object.entries(store.pendingDeletions)) {
      if (now >= item.deleteAt) {
        try {
          await callTelegram('deleteMessage', {
            chat_id: item.chatId,
            message_id: item.messageId
          });
          console.log(`[Auto-Delete Worker] Deleted message #${item.messageId} for chat ${item.chatId} (expired)`);
        } catch (err) {
          console.warn(`[Auto-Delete Worker] Failed deleting #${item.messageId}:`, err.message);
        }
        delete store.pendingDeletions[key];
        changed = true;
      }
    }

    if (changed) {
      writeBotStore(store);
    }
  } catch (err) {
    console.warn('processPendingDeletions error:', err.message);
  }
}

// Background cleanup interval (runs immediately on boot + every 15s)
if (typeof setInterval !== 'undefined') {
  setTimeout(() => {
    processPendingDeletions().catch(() => {});
  }, 2000);

  setInterval(() => {
    processPendingDeletions().catch(() => {});
  }, 15000);
}

/**
 * Backward compatibility helper for direct delayed deletion
 */
export function scheduleMessageDeletion(chatId, messageId, delaySeconds = 120) {
  if (!chatId || !messageId) return;
  setTimeout(async () => {
    try {
      await callTelegram('deleteMessage', {
        chat_id: chatId,
        message_id: messageId
      });
      console.log(`[Auto-Delete] Deleted message #${messageId} in chat ${chatId} after ${delaySeconds}s`);
    } catch (err) {
      console.warn(`[Auto-Delete] Message #${messageId} deletion note:`, err.message);
    }
  }, Math.max(1, delaySeconds) * 1000);
}

/**
 * Upload base64 screenshot to Supabase Storage inside the 'screenshots' folder
 */
async function ensureScreenshotUploaded(orderId, rawScreenshot) {
  if (!rawScreenshot || typeof rawScreenshot !== 'string') return '';
  const trimmed = rawScreenshot.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('data:') || trimmed.length > 100) {
    try {
      const { url, key } = getSupabaseConfig();
      const bucket = process.env.SUPABASE_BUCKET || 'linkadda-media';
      const fileName = `screenshot_${String(orderId || 'ord').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.jpg`;
      const cleanKey = `screenshots/${fileName}`;

      let base64Data = trimmed;
      let contentType = 'image/jpeg';
      if (trimmed.includes('base64,')) {
        const parts = trimmed.split('base64,');
        base64Data = parts[1];
        const mimeMatch = parts[0].match(/data:([^;]+);/);
        if (mimeMatch) contentType = mimeMatch[1];
      }

      const buffer = Buffer.from(base64Data, 'base64');
      const endpoint = `${url.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURI(cleanKey)}`;

      const upRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'x-upsert': 'true',
          'Content-Type': contentType,
        },
        body: buffer
      });

      if (upRes.ok) {
        return `${url.replace(/\/+$/, '')}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURI(cleanKey)}`;
      }
    } catch (err) {
      console.warn('Screenshot upload notice in bot handler:', err.message);
    }
  }
  return '';
}

// In-memory deduplication map for order notifications to prevent spam loops
const recentOrderNotifications = new Map();
const ORDER_NOTIFY_DEBOUNCE_MS = 45000;

/**
 * Send New Order Notification to BOTH Admins with Screenshot + [Approve] [Reject] buttons
 */
export async function notifyAdminsNewOrder(order) {
  const adminIds = getAdminChatIds();
  const orderId = String(order.order_id || order.id || order.orderId || '').trim();
  if (!orderId) {
    return { ok: false, error: 'Missing order ID' };
  }

  // Deduplication guard: ignore duplicate calls for the same order within 45s
  const now = Date.now();
  if (recentOrderNotifications.has(orderId)) {
    const lastSent = recentOrderNotifications.get(orderId);
    if (now - lastSent < ORDER_NOTIFY_DEBOUNCE_MS) {
      return { ok: true, deduplicated: true, message: 'Notification already dispatched' };
    }
  }
  recentOrderNotifications.set(orderId, now);
  if (recentOrderNotifications.size > 200) {
    for (const [k, v] of recentOrderNotifications.entries()) {
      if (now - v > 120000) recentOrderNotifications.delete(k);
    }
  }

  const productTitle = order.product_title || order.productTitle || order.productName || order.title || order.name || 'VIP Content Pack';
  
  // Format amount cleanly without double symbols
  const rawAmt = String(order.amount || order.amountDisplay || '399').trim();
  const amount = rawAmt.startsWith('₹') || rawAmt.startsWith('$') ? rawAmt : (order.currency === 'USD' ? `$${rawAmt}` : `₹${rawAmt}`);
  
  const method = order.payment_method || order.method || 'UPI / QR';
  const utr = order.utr || order.transactionId || 'Not provided';
  const tgUser = order.telegramUsername ? `@${order.telegramUsername}` : (order.telegramUserId ? `ID: ${order.telegramUserId}` : 'Website Checkout');
  
  const rawScreenshot = String(order.payment_proof || order.screenshotUrl || order.paymentProof || '').trim();
  let uploadedScreenshotUrl = '';

  // 1. Extract raw image buffer directly (base64 or remote URL)
  let photoBuffer = null;
  if (rawScreenshot.startsWith('data:') || rawScreenshot.includes('base64,')) {
    try {
      const parts = rawScreenshot.split('base64,');
      const b64 = parts[1] || parts[0];
      photoBuffer = Buffer.from(b64, 'base64');
    } catch (_) {}
  } else if (rawScreenshot.startsWith('http://') || rawScreenshot.startsWith('https://')) {
    uploadedScreenshotUrl = rawScreenshot;
    try {
      const imgFetch = await fetch(rawScreenshot, { signal: AbortSignal.timeout(6000) });
      if (imgFetch.ok) {
        photoBuffer = Buffer.from(await imgFetch.arrayBuffer());
      }
    } catch (_) {}
  }

  // 2. Ensure permanent upload to Supabase storage in background if not already an HTTP URL
  if (!uploadedScreenshotUrl && rawScreenshot) {
    try {
      uploadedScreenshotUrl = await ensureScreenshotUploaded(orderId, rawScreenshot);
    } catch (_) {}
  }

  // Resolve originating bot for this order so notifications and deliveries are 100% accurate
  await syncBotsFromSupabase().catch(() => {});
  const store = readBotStore();
  let allBots = getConnectedBots();
  const primaryBot = allBots.find(b => b.isPrimary) || allBots[0] || { botId: 'bot_8923608774', username: 'Myshop9876_bot', token: store.activeToken };

  const customerTgId = order.telegramUserId || order.data?.telegramUserId || order.telegram_user_id;
  const userRecord = customerTgId ? store.users?.[String(customerTgId)] : null;
  const rawBotId = order.source_bot_id || order.sourceBotId || order.data?.source_bot_id || order.data?.sourceBotId || userRecord?.lastBotId || userRecord?.sourceBotId || null;
  let originatingBot = null;
  if (rawBotId) {
    const cleanId = String(rawBotId).toLowerCase().replace('@', '');
    originatingBot = allBots.find(b => b.botId.toLowerCase() === cleanId || b.id === cleanId || (b.username && b.username.toLowerCase() === cleanId));
    if (!originatingBot) {
      await syncBotsFromSupabase(true).catch(() => {});
      allBots = getConnectedBots();
      originatingBot = allBots.find(b => b.botId.toLowerCase() === cleanId || b.id === cleanId || (b.username && b.username.toLowerCase() === cleanId));
    }
  }
  const isRealBotOrder = Boolean(rawBotId && originatingBot);
  if (!originatingBot) originatingBot = primaryBot;
  const originatingToken = originatingBot?.token || primaryBot.token;

  // Persist resolved bot onto order data ONLY if it originated from a real bot
  if (isRealBotOrder) {
    order.sourceBotId = originatingBot.botId;
    order.sourceBotUsername = originatingBot.username;

    // Record customer under this EXACT originating bot
    if (customerTgId) {
      const custUsername = order.telegramUsername || order.data?.telegramUsername || order.telegram || '';
      const custName = order.customerName || order.customer_name || order.name || '';
      recordBotUser({
        id: customerTgId,
        username: custUsername,
        first_name: custName || (custUsername ? `@${custUsername}` : `User #${customerTgId}`),
        last_name: '',
        botId: originatingBot.botId
      }, 'order_checkout', originatingBot.botId).catch(() => {});
    }
  }

  // 3. Update Supabase order row with permanent screenshot URL and resolved source bot
  if (uploadedScreenshotUrl || (isRealBotOrder && originatingBot.botId)) {
    try {
      const { url, key } = getSupabaseConfig();
      fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          payment_proof: uploadedScreenshotUrl || undefined, 
          updated_at: new Date().toISOString(),
          data: {
            ...(order.data || {}),
            sourceBotId: isRealBotOrder ? originatingBot.botId : null,
            sourceBotUsername: isRealBotOrder ? originatingBot.username : null
          }
        })
      }).catch(() => {});
    } catch (_) {}
  }

  const caption = 
    `🚨 <b>NEW ORDER RECEIVED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🆔 <b>Order ID:</b> <code>${orderId}</code>\n` +
    `🤖 <b>Bot Channel:</b> <b>${isRealBotOrder ? `@${escapeTelegramHtml(originatingBot.username || 'Bot')}` : '🌐 Direct Web (No Bot)'}</b>\n` +
    `📦 <b>Product:</b> <b>${escapeTelegramHtml(productTitle)}</b>\n` +
    `💰 <b>Amount:</b> <b>${amount}</b>\n` +
    `💳 <b>Payment Method:</b> ${method}\n` +
    `🔢 <b>UTR / Transaction Ref:</b> <code>${utr}</code>\n` +
    `👤 <b>Customer:</b> ${tgUser}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Review payment screenshot and tap below to Approve or Reject:</i>`;

  const viewScreenshotUrl = uploadedScreenshotUrl || (rawScreenshot.startsWith('http') ? rawScreenshot : '');
  const inlineKeyboard = {
    inline_keyboard: [
      ...(viewScreenshotUrl
        ? [[{ text: '🔍 View Full Screenshot', url: viewScreenshotUrl }]]
        : []),
      [
        { text: '✅ Approve Order', callback_data: `appr_${orderId}` },
        { text: '❌ Reject Order', callback_data: `rejc_${orderId}` }
      ]
    ]
  };

  // ── 1. INSTANT CUSTOMER RECEIPT NOTIFICATION ──
  // Send instant confirmation receipt directly into customer's chat in the EXACT bot they purchased from
  if (customerTgId) {
    try {
      const custText =
        `🛍️ <b>Order Placed Successfully!</b>\n\n` +
        `🆔 <b>Order ID:</b> <code>${orderId}</code>\n` +
        `📦 <b>Product:</b> <b>${escapeTelegramHtml(productTitle)}</b>\n` +
        `💰 <b>Amount:</b> <b>${amount}</b>\n` +
        `💳 <b>Payment Method:</b> ${method}\n` +
        (utr && utr !== 'Not provided' ? `🔢 <b>UTR / Transaction Ref:</b> <code>${escapeTelegramHtml(utr)}</code>\n` : '') +
        `\n⏳ <b>Status: Payment Under Verification</b>\n` +
        `Our admin team has received your payment proof and is verifying the transaction.\n` +
        `<b>Your exclusive VIP content access link will be delivered right here in this chat as soon as verified!</b>\n\n` +
        `💬 <i>24/7 Priority Support Desk: @VIP_KINK</i>`;

      let custRes = await callTelegram('sendMessage', {
        chat_id: String(customerTgId),
        text: custText,
        parse_mode: 'HTML'
      }, originatingToken).catch(() => null);

      if (!custRes?.ok && originatingToken !== primaryBot.token) {
        await callTelegram('sendMessage', {
          chat_id: String(customerTgId),
          text: custText,
          parse_mode: 'HTML'
        }, primaryBot.token).catch(() => {});
      }
    } catch (custErr) {
      console.warn('Customer confirmation dispatch error:', custErr.message);
    }
  }

  // ── 2. INSTANT ADMIN PROOF ALERT DISPATCH WITH APPROVE / REJECT BUTTONS ──
  const results = [];
  const sentAdminMessages = [];

  for (const adminId of adminIds) {
    // ⚡ Bot-Specific Admin Routing: check if admin is assigned to a specific bot
    const adminProf = store.adminProfiles?.[String(adminId)] || {};
    if (adminProf.assignedBotId && adminProf.assignedBotId !== 'all') {
      const assignedTarget = String(adminProf.assignedBotId).toLowerCase().replace('@', '');
      const ordTarget = String(originatingBot.botId || originatingBot.id || '').toLowerCase().replace('@', '');
      const ordUsername = String(originatingBot.username || '').toLowerCase().replace('@', '');
      if (assignedTarget !== ordTarget && assignedTarget !== ordUsername) {
        continue; // Skip admin: order came from a different bot!
      }
    }

    let sentRes = null;
    let isPhoto = false;
    let usedToken = originatingToken;
    let usedBot = originatingBot;

    // Helper: Build a FRESH multipart FormData for every send attempt (prevents body consumed errors)
    const buildPhotoFormData = () => {
      const fd = new FormData();
      fd.append('chat_id', String(adminId));
      fd.append('caption', caption);
      fd.append('parse_mode', 'HTML');
      fd.append('reply_markup', JSON.stringify(inlineKeyboard));
      const blob = new Blob([photoBuffer], { type: 'image/jpeg' });
      fd.append('photo', blob, `payment_${orderId}.jpg`);
      return fd;
    };

    // Fleet candidate bots: Originating bot first, followed by all other active fleet bots
    const candidateFleetBots = [
      originatingBot,
      ...allBots.filter(b => b.token && b.token !== originatingToken && b.status !== 'inactive')
    ];

    for (const targetBot of candidateFleetBots) {
      const candidateToken = targetBot.token;
      if (!candidateToken) continue;

      // A. Priority 1: Direct Binary Multipart Upload
      if (photoBuffer && photoBuffer.length > 200) {
        try {
          sentRes = await callTelegram('sendPhoto', buildPhotoFormData(), candidateToken);
          if (sentRes && sentRes.ok) {
            isPhoto = true;
            usedToken = candidateToken;
            usedBot = targetBot;
            break;
          }
        } catch (_) {}
      }

      // B. Priority 2: Remote URL sendPhoto fallback
      if (!sentRes?.ok && viewScreenshotUrl) {
        try {
          sentRes = await callTelegram('sendPhoto', {
            chat_id: String(adminId),
            photo: viewScreenshotUrl,
            caption: caption,
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard
          }, candidateToken);
          if (sentRes && sentRes.ok) {
            isPhoto = true;
            usedToken = candidateToken;
            usedBot = targetBot;
            break;
          }
        } catch (_) {}
      }

      // C. Priority 3: HTML text fallback with link to screenshot and Approve/Reject inline keyboard
      if (!sentRes?.ok) {
        try {
          sentRes = await callTelegram('sendMessage', {
            chat_id: String(adminId),
            text: caption + (viewScreenshotUrl ? `\n\n📸 <b>Payment Proof:</b> <a href="${viewScreenshotUrl}">Tap to View Screenshot</a>` : ''),
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard
          }, candidateToken);
          if (sentRes && sentRes.ok) {
            isPhoto = false;
            usedToken = candidateToken;
            usedBot = targetBot;
            break;
          }
        } catch (_) {}
      }
    }

    results.push(sentRes);

    // Save message ID to track for approval updates
    if (sentRes?.ok && sentRes?.result?.message_id) {
      sentAdminMessages.push({
        chatId: String(adminId),
        messageId: sentRes.result.message_id,
        botId: usedBot.botId,
        botToken: usedToken,
        isPhoto,
        caption,
        sentAt: Date.now()
      });
    }
  }

  // Persist sent admin messages in bot_store.json so approval edits them instantly
  if (sentAdminMessages.length > 0) {
    try {
      const store = readBotStore();
      if (!store.orderAdminMessages) store.orderAdminMessages = {};
      store.orderAdminMessages[orderId] = sentAdminMessages;
      const orderKeys = Object.keys(store.orderAdminMessages);
      if (orderKeys.length > 200) {
        delete store.orderAdminMessages[orderKeys[0]];
      }
      writeBotStore(store);
    } catch (saveErr) {
      console.warn('Could not save orderAdminMessages:', saveErr.message);
    }
  }

  return { ok: true, sentTo: adminIds.length };
}

/**
 * Handle Order Approval: Update DB, Update Telegram Admin Messages, and Notify Customer
 */
async function processOrderApproval(orderId, adminUser) {
  const { url, key } = getSupabaseConfig();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };

  // Fetch order matching either id or order_id
  let order = null;
  try {
    const orderRes = await fetch(`${url}/rest/v1/orders?or=(id.eq.${encodeURIComponent(orderId)},order_id.eq.${encodeURIComponent(orderId)})&select=*`, {
      headers,
      signal: AbortSignal.timeout(6000)
    });
    if (orderRes.ok) {
      const rows = await orderRes.json();
      if (rows && rows.length) order = rows[0];
    }
  } catch (err) {
    console.warn('Order fetch error in approval:', err.message);
  }

  // Fetch matched product to check for specific channelLink
  let channelLink = order?.channel_link || order?.data?.channelLink || '';
  const productId = order?.product_id || order?.data?.productId || order?.productId;
  if (!channelLink && productId) {
    try {
      const pRes = await fetch(`${url}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=*`, {
        headers,
        signal: AbortSignal.timeout(4000)
      });
      if (pRes.ok) {
        const pRows = await pRes.json();
        channelLink = pRows?.[0]?.channel_link || pRows?.[0]?.data?.channelLink || '';
      }
    } catch (_) {}
  }
  if (channelLink.includes('VIP_KINK') || channelLink.includes('TRUSTED_BROTHER1234')) channelLink = '';

  const adminName = adminUser?.first_name || (adminUser?.username ? `@${adminUser.username}` : String(adminUser?.id || 'Admin'));

  const approvedData = {
    ...(order?.data || {}),
    status: 'approved',
    orderStatus: 'approved',
    paymentStatus: 'approved',
    isPaid: true,
    verified: true,
    approved: true,
    channelLink: channelLink || '',
    downloadLink: channelLink || '',
    fileUrl: channelLink || '',
    orderLink: channelLink || '',
    hasDirectLink: Boolean(channelLink),
    reviewedAt: Date.now(),
    approvedAt: Date.now(),
    reviewedBy: adminName,
    approvedBy: adminName
  };

  // Update order in Supabase with guaranteed AWAIT
  const targetId = order?.id || orderId;
  try {
    const patchRes = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(targetId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        status: 'approved',
        updated_at: new Date().toISOString(),
        data: approvedData
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!patchRes.ok) {
      await fetch(`${url}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          status: 'approved',
          updated_at: new Date().toISOString(),
          data: approvedData
        }),
        signal: AbortSignal.timeout(5000)
      }).catch(() => {});
    }
  } catch (patchErr) {
    console.error('Supabase PATCH error in processOrderApproval:', patchErr.message);
  }

  // Save order link in bot_store.json so view_link callback is 0ms instant
  try {
    const store = readBotStore();
    if (!store.orderLinks) store.orderLinks = {};
    store.orderLinks[orderId] = {
      channelLink: channelLink || '',
      productTitle: order?.product_title || order?.title || 'VIP Pack',
      customerTgId: order?.telegram_user_id || order?.data?.telegramUserId || order?.telegramUserId || null,
      approvedAt: Date.now()
    };
    writeBotStore(store);
  } catch (_) {}

  // ━━ LIVE SYNC: Update all Telegram Admin Messages for this Order ━━
  await syncBotsFromSupabase().catch(() => {});
  let allBots = getConnectedBots();
  const primaryBot = allBots.find(b => b.isPrimary) || allBots[0] || { botId: 'bot_8923608774', username: 'Myshop9876_bot', token: store.activeToken };
  const customerTgId = order?.telegram_user_id || order?.data?.telegramUserId || order?.telegramUserId;
  const userRecord = customerTgId ? store.users?.[String(customerTgId)] : null;
  const rawBotId = order?.source_bot_id || order?.sourceBotId || order?.data?.source_bot_id || order?.data?.sourceBotId || userRecord?.lastBotId || userRecord?.sourceBotId || null;
  let deliveryBot = null;
  if (rawBotId) {
    const cleanId = String(rawBotId).toLowerCase().replace('@', '');
    deliveryBot = allBots.find(b => b.botId.toLowerCase() === cleanId || b.id === cleanId || (b.username && b.username.toLowerCase() === cleanId));
    if (!deliveryBot) {
      await syncBotsFromSupabase(true).catch(() => {});
      allBots = getConnectedBots();
      deliveryBot = allBots.find(b => b.botId.toLowerCase() === cleanId || b.id === cleanId || (b.username && b.username.toLowerCase() === cleanId));
    }
  }
  if (!deliveryBot) deliveryBot = primaryBot;
  const deliveryToken = deliveryBot.token;

  try {
    const adminMsgs = store.orderAdminMessages?.[orderId] || [];
    const approvedTag = `\n\n━━━━━━━━━━━━━━━━━━━━━━\n✅ <b>APPROVED by ${escapeTelegramHtml(adminName)}</b>\n⚡ Status: Verified & VIP Access Dispatched`;
    const approvedKeyboard = {
      inline_keyboard: [
        [{ text: `✅ Approved by ${adminName}`, callback_data: 'noop' }]
      ]
    };

    for (const msg of adminMsgs) {
      const msgToken = msg.botToken || deliveryToken;
      if (msg.isPhoto) {
        await callTelegram('editMessageCaption', {
          chat_id: msg.chatId,
          message_id: msg.messageId,
          caption: (msg.caption || `🚨 <b>Order #${orderId}</b>`) + approvedTag,
          parse_mode: 'HTML',
          reply_markup: approvedKeyboard
        }, msgToken).catch(() => {});
      } else {
        await callTelegram('editMessageText', {
          chat_id: msg.chatId,
          message_id: msg.messageId,
          text: (msg.caption || `🚨 <b>Order #${orderId}</b>`) + approvedTag,
          parse_mode: 'HTML',
          reply_markup: approvedKeyboard
        }, msgToken).catch(() => {});
      }
    }
  } catch (adminEditErr) {
    console.warn('Could not update admin message in Telegram:', adminEditErr.message);
  }

  // Notify customer on Telegram via the EXACT bot they ordered from
  if (customerTgId) {
    const appUrl = getAppUrl();
    const productTitle = order?.product_title || order?.title || order?.data?.product_title || 'VIP Pack';
    const storeWebUrl = `${appUrl}?botId=${deliveryBot.botId}&botUser=${deliveryBot.username}`;

    if (channelLink) {
      const accessUrl = `${appUrl}/api/telegram/bot?action=access&orderId=${encodeURIComponent(orderId)}`;
      const approvalText = 
        `🎉 <b>Congratulations! Your Order #${orderId} is Approved!</b>\n\n` +
        `📦 <b>Product:</b> <b>${escapeTelegramHtml(productTitle)}</b>\n` +
        `⚡ <b>Access Status:</b> <b>Unlocked & Active</b>\n\n` +
        `🔗 <b>Direct VIP Access:</b>\n` +
        `👉 <a href="${accessUrl}"><b>Tap to Open VIP Access</b></a>\n\n` +
        `⏳ <b>Security Auto-Delete:</b>\n` +
        `• Message automatically deletes <b>2 minutes</b> after you open/read it.\n` +
        `• If unread, it automatically self-destructs after <b>3 hours</b>.\n\n` +
        `💬 <b>24/7 Lifetime Support:</b> @VIP_KINK`;

      let sendRes = await callTelegram('sendMessage', {
        chat_id: customerTgId,
        text: approvalText,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Open VIP Access Link', url: accessUrl }],
            [{ text: '🛍️ Open Store', web_app: { url: storeWebUrl } }],
            [{ text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }]
          ]
        }
      }, deliveryToken);

      // Fallback: If target bot returned error (user blocked or didn't start), try other bots user is in
      if (!sendRes?.ok && userRecord?.bots) {
        for (const [altBotId, bInfo] of Object.entries(userRecord.bots)) {
          if (altBotId === deliveryBot.botId) continue;
          const altBot = allBots.find(b => b.botId === altBotId);
          if (altBot && altBot.token) {
            sendRes = await callTelegram('sendMessage', {
              chat_id: customerTgId,
              text: approvalText,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🚀 Open VIP Access Link', url: accessUrl }],
                  [{ text: '🛍️ Open Store', web_app: { url: `${appUrl}?botId=${altBot.botId}&botUser=${altBot.username}` } }],
                  [{ text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }]
                ]
              }
            }, altBot.token).catch(() => null);
            if (sendRes?.ok) break;
          }
        }
      }

      // Register in smart deletion engine (3-hour TTL if unread; switches to 2 mins upon activity/read)
      if (sendRes?.ok && sendRes?.result?.message_id) {
        queueMessageForDeletion(customerTgId, sendRes.result.message_id, {
          orderId,
          productTitle
        });
      }
    } else {
      await callTelegram('sendMessage', {
        chat_id: customerTgId,
        text: 
          `🎉 <b>Congratulations! Your Order #${orderId} has been Approved!</b>\n\n` +
          `📦 <b>Product:</b> ${escapeTelegramHtml(productTitle)}\n\n` +
          `To claim your VIP content access, please message <b>Admin @VIP_KINK</b> on Telegram below:`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Get Link from Admin (@VIP_KINK)', url: `https://t.me/VIP_KINK?text=${encodeURIComponent(`Hi Admin, my order #${orderId} is approved. Please provide my Telegram access link.`)}` }]
          ]
        }
      }, deliveryToken);
    }
  }

  return { ok: true, channelLink, orderId };
}

/**
 * Handle Order Rejection: Update DB, Update Telegram Admin Messages, and Notify Customer
 */
async function processOrderRejection(orderId, adminUser) {
  const { url, key } = getSupabaseConfig();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };

  // Fetch order matching either id or order_id
  let order = null;
  try {
    const orderRes = await fetch(`${url}/rest/v1/orders?or=(id.eq.${encodeURIComponent(orderId)},order_id.eq.${encodeURIComponent(orderId)})&select=*`, {
      headers,
      signal: AbortSignal.timeout(6000)
    });
    if (orderRes.ok) {
      const rows = await orderRes.json();
      if (rows && rows.length) order = rows[0];
    }
  } catch (err) {
    console.warn('Order fetch error in rejection:', err.message);
  }

  const adminName = adminUser?.first_name || (adminUser?.username ? `@${adminUser.username}` : String(adminUser?.id || 'Admin'));

  const rejectedData = {
    ...(order?.data || {}),
    status: 'rejected',
    orderStatus: 'rejected',
    paymentStatus: 'rejected',
    verified: false,
    approved: false,
    rejectedAt: Date.now(),
    rejectedBy: adminName
  };

  // Update order in Supabase with guaranteed AWAIT
  const targetId = order?.id || orderId;
  try {
    const patchRes = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(targetId)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        status: 'rejected',
        updated_at: new Date().toISOString(),
        data: rejectedData
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!patchRes.ok) {
      await fetch(`${url}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          status: 'rejected',
          updated_at: new Date().toISOString(),
          data: rejectedData
        }),
        signal: AbortSignal.timeout(5000)
      }).catch(() => {});
    }
  } catch (patchErr) {
    console.error('Supabase PATCH error in processOrderRejection:', patchErr.message);
  }

  // ━━ LIVE SYNC: Update all Telegram Admin Messages for this Order ━━
  try {
    const store = readBotStore();
    const adminMsgs = store.orderAdminMessages?.[orderId] || [];
    const rejectedTag = `\n\n━━━━━━━━━━━━━━━━━━━━━━\n❌ <b>REJECTED by ${escapeTelegramHtml(adminName)}</b>\n⚡ Payment verification failed`;
    const rejectedKeyboard = {
      inline_keyboard: [
        [{ text: `❌ Rejected by ${adminName}`, callback_data: 'noop' }]
      ]
    };

    for (const msg of adminMsgs) {
      if (msg.isPhoto) {
        await callTelegram('editMessageCaption', {
          chat_id: msg.chatId,
          message_id: msg.messageId,
          caption: (msg.caption || `🚨 <b>Order #${orderId}</b>`) + rejectedTag,
          parse_mode: 'HTML',
          reply_markup: rejectedKeyboard
        });
      } else {
        await callTelegram('editMessageText', {
          chat_id: msg.chatId,
          message_id: msg.messageId,
          text: (msg.caption || `🚨 <b>Order #${orderId}</b>`) + rejectedTag,
          parse_mode: 'HTML',
          reply_markup: rejectedKeyboard
        });
      }
    }
  } catch (adminEditErr) {
    console.warn('Could not update admin message in Telegram:', adminEditErr.message);
  }

  // Notify customer on Telegram
  const customerTgId = order?.telegram_user_id || order?.data?.telegramUserId || order?.telegramUserId;
  if (customerTgId) {
    await callTelegram('sendMessage', {
      chat_id: customerTgId,
      text: 
        `❌ <b>Order #${orderId} Verification Unsuccessful</b>\n\n` +
        `The payment screenshot or UTR transaction reference could not be validated.\n\n` +
        `If you have completed the payment, please contact Support with your payment proof:`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 Contact Support (@VIP_KINK)', url: `https://t.me/VIP_KINK?text=${encodeURIComponent(`Hi Admin, my order #${orderId} was rejected. Here is my payment receipt.`)}` }]
        ]
      }
    });
  }

  return { ok: true, orderId };
}

function escapeTelegramHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Broadcast New Product to all Telegram Bot Users
 * Supports dual Telegram Mini App options:
 * 1. View Product (Full gallery slideshow, video demo, specs, reviews, tiers)
 * 2. Instant Buy Now & Checkout (Direct payment.html sheet)
 */
export async function broadcastNewProduct(rawProduct, targetBotIds = ['all']) {
  let product = rawProduct?.product || rawProduct || {};
  if (typeof product === 'string') {
    product = { id: product };
  }

  // If payload only has an ID or is missing title/price, fetch live from Supabase (Zero hardcoding)
  const lookupId = product.id || product.productId || product.key || product.slug || '';
  if (lookupId && ((!product.title && !product.name && !product.badge) || (!product.priceINR && !product.price_inr && !product.price))) {
    try {
      const { url, key } = getSupabaseConfig();
      const fetchRes = await fetch(`${url}/rest/v1/products?id=eq.${encodeURIComponent(lookupId)}&select=*`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
      if (fetchRes.ok) {
        const rows = await fetchRes.json();
        if (rows && rows[0]) {
          const r = rows[0];
          const p = (r.data && typeof r.data === 'object') ? r.data : {};
          product = Object.assign({}, p, r, product);
        }
      }
    } catch (err) {
      console.warn('Could not fetch fresh product details from db for broadcast:', err.message);
    }
  }

  // 1. Title Extraction (support title, name, badge, id)
  const title = String(product.title || product.name || product.badge || product.id || 'Exclusive VIP Pack').trim();
  const safeTitle = escapeTelegramHtml(title);

  // 2. Price Extraction (strip any currency symbols and clean)
  let rawInr = product.priceINR || product.price_inr || product.inr || product.price || '';
  if (!rawInr && Array.isArray(product.tiers) && product.tiers.length > 0) {
    rawInr = product.tiers[0].inr || product.tiers[0].price || '';
  }
  const cleanInr = String(rawInr || '299').replace(/[^0-9.]/g, '').trim() || '299';

  let rawUsd = product.priceUSD || product.price_usd || product.usd || '';
  if (!rawUsd && Array.isArray(product.tiers) && product.tiers.length > 0) {
    rawUsd = product.tiers[0].usd || '';
  }
  const cleanUsd = String(rawUsd || '15').replace(/[^0-9.]/g, '').trim() || '15';

  // 3. Description Extraction
  const rawDesc = String(product.shortDescription || product.description || product.desc || '').trim();
  const cleanTextDesc = rawDesc.replace(/<[^>]*>?/gm, '').trim();
  const cleanDesc = cleanTextDesc ? escapeTelegramHtml(cleanTextDesc.slice(0, 140)) + (cleanTextDesc.length > 140 ? '...' : '') : '';

  // 4. Image URL normalization
  let rawImg = product.image || product.thumbnail || product.photo || (Array.isArray(product.images) && product.images.length ? product.images[0] : '') || '';
  let image = String(rawImg || '').trim();
  if (image && !image.startsWith('http://') && !image.startsWith('https://')) {
    if (image.startsWith('images/')) {
      image = `https://esxiwfswnbacmpjxqgsn.supabase.co/storage/v1/object/public/linkadda-media/${image}`;
    } else if (image.startsWith('/images/')) {
      image = `https://esxiwfswnbacmpjxqgsn.supabase.co/storage/v1/object/public/linkadda-media${image}`;
    } else if (image.startsWith('/media/')) {
      image = `https://esxiwfswnbacmpjxqgsn.supabase.co/storage/v1/object/public/linkadda-media/${image.replace(/^\/media\//, '')}`;
    } else if (image.startsWith('linkadda-media/')) {
      image = `https://esxiwfswnbacmpjxqgsn.supabase.co/storage/v1/object/public/${image}`;
    } else if (image.startsWith('products/') || image.startsWith('categories/')) {
      image = `https://esxiwfswnbacmpjxqgsn.supabase.co/storage/v1/object/public/linkadda-media/${image}`;
    } else if (image.startsWith('/')) {
      image = `${getAppUrl()}${image}`;
    } else {
      image = `${getAppUrl()}/${image}`;
    }
  }

  // 5. Safe HTTPS URLs for Telegram WebApp
  const appUrl = getAppUrl();
  const tgAppUrl = appUrl.startsWith('https://') ? appUrl : 'https://linkadda-online.onrender.com';

  const prodParam = encodeURIComponent(lookupId || title);
  const nameParam = encodeURIComponent(title);
  const inrParam = encodeURIComponent(cleanInr);
  const usdParam = encodeURIComponent(cleanUsd);

  const productViewUrl = `${tgAppUrl}/index.html?productId=${prodParam}&name=${nameParam}&inr=${inrParam}&usd=${usdParam}`;
  const checkoutUrl = `${tgAppUrl}/payment.html?productId=${prodParam}&name=${nameParam}&inr=${inrParam}&usd=${usdParam}`;

  const messageText = 
    `🔥 <b>NEW VIP PACK RELEASED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 <b>${safeTitle}</b>\n` +
    `💰 <b>Price:</b> ₹${cleanInr} / $${cleanUsd}\n` +
    `✨ <i>Instant delivery & 100% discrete access!</i>\n` +
    (cleanDesc ? `\n📝 <i>${cleanDesc}</i>\n` : '') +
    `\nTap <b>View Product</b> to see photos & video demo inside Telegram,\nor tap <b>Buy Now</b> to proceed to instant checkout:`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '👀 View Product (Photos & Demo)', web_app: { url: productViewUrl } }
      ],
      [
        { text: '⚡ Buy Now & Unlock Access', web_app: { url: checkoutUrl } }
      ],
      [
        { text: '🛍️ Open VIP Store', web_app: { url: tgAppUrl } },
        { text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }
      ]
    ]
  };

  // 6. Multi-Bot Target Fleet Resolution
  const allActiveBots = getConnectedBots().filter(b => b.status === 'active');
  const isAll = !targetBotIds || (Array.isArray(targetBotIds) && (targetBotIds.length === 0 || targetBotIds.includes('all')));
  const targetList = Array.isArray(targetBotIds) ? targetBotIds : [targetBotIds];
  const selectedBots = isAll 
    ? allActiveBots 
    : allActiveBots.filter(b => targetList.includes(b.botId) || targetList.includes(b.id) || targetList.includes(b.username));
  const fleet = selectedBots.length > 0 ? selectedBots : [getBotByIdOrToken()].filter(Boolean);

  const botUsers = await getAllBotUsers();
  const adminIds = getAdminChatIds();

  let sentCount = 0;
  let failCount = 0;
  let totalRecipients = 0;
  const sampleErrors = [];
  const botBreakdown = {};
  const deliveredChatIds = new Set();

  for (let bIndex = 0; bIndex < fleet.length; bIndex++) {
    const currentBot = fleet[bIndex];
    if (!currentBot || !currentBot.token) continue;
    const botKey = currentBot.username || currentBot.id || `bot_${bIndex}`;
    botBreakdown[botKey] = { sent: 0, failed: 0 };

    const botParam = `botId=${encodeURIComponent(currentBot.botId)}&botUser=${encodeURIComponent(currentBot.username || '')}`;
    const curProductViewUrl = `${tgAppUrl}/index.html?productId=${prodParam}&name=${nameParam}&inr=${inrParam}&usd=${usdParam}&${botParam}`;
    const curCheckoutUrl = `${tgAppUrl}/payment.html?productId=${prodParam}&name=${nameParam}&inr=${inrParam}&usd=${usdParam}&${botParam}`;
    const curStoreWebUrl = `${tgAppUrl}?${botParam}`;
    const botKeyboard = {
      inline_keyboard: [
        [{ text: '👀 View Product (Photos & Demo)', web_app: { url: curProductViewUrl } }],
        [{ text: '⚡ Buy Now & Unlock Access', web_app: { url: curCheckoutUrl } }],
        [
          { text: '🛍️ Open VIP Store', web_app: { url: curStoreWebUrl } },
          { text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }
        ]
      ]
    };

    const recipientMap = new Map();

    // Admins receive notification on first bot in fleet so admins verify without 5x duplicate spam
    if (bIndex === 0) {
      for (const adminId of adminIds) {
        if (adminId && String(adminId).trim()) {
          recipientMap.set(String(adminId).trim(), { id: String(adminId).trim(), role: 'admin' });
        }
      }
    }

    // Subscribers belonging to this bot (supports users enrolled in multiple bots!)
    for (const user of (botUsers || [])) {
      const uid = String(user?.id || user?.telegramUserId || '').trim();
      if (!uid) continue;
      const belongs = doesUserBelongToFleetBot(user, currentBot, fleet);
      if (belongs) {
        recipientMap.set(uid, { ...(user || {}), id: uid });
      }
    }

    const recipients = Array.from(recipientMap.values());
    totalRecipients += recipients.length;

    for (const target of recipients) {
      const chatId = target.id;
      if (!chatId) continue;
      // Skip non-admins if already successfully delivered by an earlier bot in this multi-bot run
      if (isAll && target.role !== 'admin' && deliveredChatIds.has(chatId)) {
        continue;
      }
      let delivered = false;

      if (image && (image.startsWith('http://') || image.startsWith('https://'))) {
        try {
          const photoRes = await callTelegram('sendPhoto', {
            chat_id: chatId,
            photo: image,
            caption: messageText,
            parse_mode: 'HTML',
            reply_markup: botKeyboard
          }, currentBot.token);
          if (photoRes && photoRes.ok) delivered = true;
        } catch (_) {}
      }

      if (!delivered) {
        try {
          const msgRes = await callTelegram('sendMessage', {
            chat_id: chatId,
            text: messageText,
            parse_mode: 'HTML',
            reply_markup: botKeyboard
          }, currentBot.token);
          if (msgRes && msgRes.ok) {
            delivered = true;
          } else if (sampleErrors.length < 5) {
            sampleErrors.push(`${chatId} (@${currentBot.username}): ${msgRes?.description || 'failed'}`);
          }
        } catch (msgErr) {
          if (sampleErrors.length < 5) {
            sampleErrors.push(`${chatId}: ${msgErr.message}`);
          }
        }
      }

      if (delivered) {
        sentCount++;
        deliveredChatIds.add(chatId);
        botBreakdown[botKey].sent++;
      } else {
        failCount++;
        botBreakdown[botKey].failed++;
      }

      await new Promise(r => setTimeout(r, 45));
    }
  }

  return { 
    ok: sentCount > 0, 
    sentCount, 
    failCount,
    totalRecipients,
    botsCount: fleet.length,
    botBreakdown,
    error: sentCount === 0 ? (sampleErrors[0] || 'Failed to dispatch to Telegram') : null
  };
}

/**
 * Generic Custom Announcement / Promotion Broadcast to all bot users
 */
export async function broadcastCustomMessage({ message, photo, buttonText, buttonUrl, targetBotIds = ['all'] }) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    return { ok: false, error: 'Broadcast message content cannot be empty.' };
  }
  const cleanMsg = message.trim();
  const botUsers = await getAllBotUsers();
  const adminIds = getAdminChatIds();

  // Multi-Bot Target Fleet Resolution
  const allActiveBots = getConnectedBots().filter(b => b.status === 'active');
  const isAll = !targetBotIds || (Array.isArray(targetBotIds) && (targetBotIds.length === 0 || targetBotIds.includes('all')));
  const targetList = Array.isArray(targetBotIds) ? targetBotIds : [targetBotIds];
  const selectedBots = isAll 
    ? allActiveBots 
    : allActiveBots.filter(b => targetList.includes(b.botId) || targetList.includes(b.id) || targetList.includes(b.username));
  const fleet = selectedBots.length > 0 ? selectedBots : [getBotByIdOrToken()].filter(Boolean);

  const appUrl = getAppUrl();
  const tgAppUrl = appUrl.startsWith('https://') ? appUrl : 'https://linkadda-online.onrender.com';
  const cleanPhoto = photo && typeof photo === 'string' && photo.trim().startsWith('http') ? photo.trim() : null;
  const cleanBtnText = buttonText && typeof buttonText === 'string' && buttonText.trim() ? buttonText.trim() : null;
  const rawBtnUrl = buttonUrl && typeof buttonUrl === 'string' && buttonUrl.trim() ? buttonUrl.trim() : tgAppUrl;
  const cleanBtnUrl = rawBtnUrl.startsWith('http') ? rawBtnUrl : `https://${rawBtnUrl.replace(/^\/+/, '')}`;

  let replyMarkup = undefined;
  if (cleanBtnText) {
    const isTgMiniApp = cleanBtnUrl.startsWith(tgAppUrl) || cleanBtnUrl.includes('linkadda');
    replyMarkup = {
      inline_keyboard: [
        [{
          text: cleanBtnText,
          ...(isTgMiniApp && cleanBtnUrl.startsWith('https://')
            ? { web_app: { url: cleanBtnUrl } }
            : { url: cleanBtnUrl })
        }]
      ]
    };
  }

  let sentCount = 0;
  let failCount = 0;
  let totalRecipients = 0;
  const sampleErrors = [];
  const botBreakdown = {};
  const deliveredChatIds = new Set();

  for (let bIndex = 0; bIndex < fleet.length; bIndex++) {
    const currentBot = fleet[bIndex];
    if (!currentBot || !currentBot.token) continue;
    const botKey = currentBot.username || currentBot.id || `bot_${bIndex}`;
    botBreakdown[botKey] = { sent: 0, failed: 0 };

    const recipientMap = new Map();

    // Admins receive notification on first bot in fleet
    if (bIndex === 0) {
      for (const adminId of adminIds) {
        if (adminId && String(adminId).trim()) {
          recipientMap.set(String(adminId).trim(), { id: String(adminId).trim(), role: 'admin' });
        }
      }
    }

    // Subscribers belonging to this bot (supports users enrolled in multiple bots!)
    for (const user of (botUsers || [])) {
      const uid = String(user?.id || user?.telegramUserId || '').trim();
      if (!uid) continue;
      const belongs = doesUserBelongToFleetBot(user, currentBot, fleet);
      if (belongs) {
        recipientMap.set(uid, { ...(user || {}), id: uid });
      }
    }

    const recipients = Array.from(recipientMap.values());
    totalRecipients += recipients.length;

    for (const target of recipients) {
      const chatId = target.id;
      if (!chatId) continue;
      // Skip non-admins if already successfully delivered by an earlier bot in this multi-bot run
      if (isAll && target.role !== 'admin' && deliveredChatIds.has(chatId)) {
        continue;
      }
      let delivered = false;

      if (cleanPhoto) {
        try {
          const photoRes = await callTelegram('sendPhoto', {
            chat_id: chatId,
            photo: cleanPhoto,
            caption: cleanMsg,
            parse_mode: 'HTML',
            ...(replyMarkup ? { reply_markup: replyMarkup } : {})
          }, currentBot.token);
          if (photoRes && photoRes.ok) delivered = true;
        } catch (_) {}
      }

      if (!delivered) {
        try {
          const msgRes = await callTelegram('sendMessage', {
            chat_id: chatId,
            text: cleanMsg,
            parse_mode: 'HTML',
            ...(replyMarkup ? { reply_markup: replyMarkup } : {})
          }, currentBot.token);
          if (msgRes && msgRes.ok) {
            delivered = true;
          } else if (sampleErrors.length < 5) {
            sampleErrors.push(`${chatId} (@${currentBot.username}): ${msgRes?.description || 'failed'}`);
          }
        } catch (msgErr) {
          if (sampleErrors.length < 5) {
            sampleErrors.push(`${chatId}: ${msgErr.message}`);
          }
        }
      }

      if (delivered) {
        sentCount++;
        deliveredChatIds.add(chatId);
        botBreakdown[botKey].sent++;
      } else {
        failCount++;
        botBreakdown[botKey].failed++;
      }

      await new Promise(r => setTimeout(r, 45));
    }
  }

  return {
    ok: sentCount > 0,
    sentCount,
    failCount,
    totalRecipients,
    botsCount: fleet.length,
    botBreakdown,
    error: sentCount === 0 ? (sampleErrors[0] || 'Broadcast failed to deliver') : null
  };
}

let lastHookCheck = 0;
export async function ensureWebhookActive(req = null) {
  const now = Date.now();
  if (now - lastHookCheck < 45000) return;
  lastHookCheck = now;
  try {
    const activeBots = getConnectedBots().filter(b => b.status === 'active');
    const appUrl = getAppUrl(req);
    for (const bot of activeBots) {
      if (!bot.token) continue;
      const expectedWebhook = `${appUrl}/api/telegram/bot?botId=${bot.botId}`;
      const info = await callTelegram('getWebhookInfo', {}, bot.token).catch(() => null);
      const currentUrl = info?.result?.url || '';
      if (!currentUrl || currentUrl !== expectedWebhook) {
        console.log(`[TELEGRAM WEBHOOK REPAIR] Webhook missing or mismatch for ${bot.username}, setting:`, expectedWebhook);
        await callTelegram('setWebhook', {
          url: expectedWebhook,
          drop_pending_updates: false,
          allowed_updates: ['message', 'callback_query']
        }, bot.token).catch(() => {});
        const storeWebUrl = `${appUrl}?botId=${bot.botId}&botUser=${encodeURIComponent(bot.username || '')}`;
        await callTelegram('setChatMenuButton', {
          menu_button: {
            type: 'web_app',
            text: '🛍️ Open Store',
            web_app: { url: storeWebUrl }
          }
        }, bot.token).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[TELEGRAM WEBHOOK REPAIR] Error:', err.message);
  }
}

/**
 * Main Webhook Handler
 */
export default async function handler(req, res) {
  if (handleCors(req, res, 'GET, POST, OPTIONS')) return;

  // Sync latest bot fleet from Supabase database to guarantee 100% persistence
  await syncBotsFromSupabase().catch(() => {});

  // Background self-healing check to guarantee webhook stays connected to LinkAdda
  ensureWebhookActive(req).catch(() => {});

  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || '';

  // Setup / Re-register Webhook endpoint across all fleet bots
  if ((action === 'setup-webhook' || action === 're-register-webhook') || (req.body && req.body.action === 're-register-webhook')) {
    await syncBotsFromSupabase(true).catch(() => {});
    const appUrl = getAppUrl(req);
    const allBots = getConnectedBots();
    const primaryBot = allBots.find(b => b.isPrimary) || allBots[0] || { botId: 'bot_8923608774', username: 'Myshop9876_bot' };

    let lastHookRes = null;
    let registeredCount = 0;
    for (const b of allBots) {
      if (!b.token || b.status === 'inactive') continue;
      const bWebhook = `${appUrl}/api/telegram/bot?botId=${b.botId}`;
      const setRes = await callTelegram('setWebhook', {
        url: bWebhook,
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query']
      }, b.token).catch(() => null);
      if (setRes && setRes.ok) registeredCount++;
      lastHookRes = setRes;

      const storeWebUrl = `${appUrl}?botId=${b.botId}&botUser=${encodeURIComponent(b.username || '')}`;
      await callTelegram('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: '🛍️ Open Store',
          web_app: { url: storeWebUrl }
        }
      }, b.token).catch(() => {});
    }

    const webhookInfo = await callTelegram('getWebhookInfo', {}, primaryBot.token).catch(() => null);
    const hookData = (webhookInfo && webhookInfo.ok && webhookInfo.result) 
      ? webhookInfo.result 
      : { url: `${appUrl}/api/telegram/bot?botId=${primaryBot.botId}`, pending_update_count: 0 };

    return res.status(200).json({ 
      ok: true, 
      registeredCount,
      webhookUrl: `${appUrl}/api/telegram/bot?botId=${primaryBot.botId}`, 
      result: lastHookRes, 
      webhook: hookData 
    });
  }

  // ── VIP Direct Link Instant Access & Auto-Delete Trigger (0ms Redirect) ─────
  if (action === 'access' || url.pathname.endsWith('/access')) {
    const orderId = String(url.searchParams.get('orderId') || '').trim();
    if (!orderId) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<h3>Order ID missing</h3>');
      return;
    }
    const store = readBotStore();
    const linkInfo = store.orderLinks?.[orderId] || {};
    let targetUrl = linkInfo.channelLink || '';
    let customerTgId = linkInfo.customerTgId || null;

    // If not cached locally, look up order in Supabase and verify it was actually APPROVED
    if ((!targetUrl || !customerTgId) && orderId) {
      try {
        const { url: sbUrl, key: sbKey } = getSupabaseConfig();
        const fetchRes = await fetch(`${sbUrl}/rest/v1/orders?or=(id.eq.${encodeURIComponent(orderId)},order_id.eq.${encodeURIComponent(orderId)})&select=*`, {
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
        });
        if (fetchRes.ok) {
          const rows = await fetchRes.json();
          if (rows && rows[0]) {
            const isApproved = rows[0].status === 'approved' || rows[0].status === 'verified';
            if (isApproved) {
              if (!targetUrl) {
                targetUrl = rows[0].channel_link || rows[0].data?.channelLink || '';
              }
              if (!customerTgId) {
                customerTgId = rows[0].telegram_user_id || rows[0].data?.telegramUserId || rows[0].telegramUserId || null;
              }
            }
          }
        }
      } catch (_) {}
    }

    // Security Guard: Never leak default VIP channel if order is invalid or unapproved
    if (!targetUrl) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>VIP Access</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;padding:20px;box-sizing:border-box;"><div style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:32px 24px;max-width:420px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.5);"><div style="font-size:42px;margin-bottom:12px;">🔒</div><h2 style="margin:0 0 8px;font-size:20px;color:#f43f5e;">Access Not Ready</h2><p style="margin:0 0 20px;color:#94a3b8;font-size:14px;line-height:1.5;">This order has not been approved yet or is invalid. If you already completed payment, please wait for admin verification.</p><a href="/" style="display:inline-block;background:#38bdf8;color:#0f172a;padding:10px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">Return to Store</a></div></body></html>`);
      return;
    }

    // Trigger instant 2-minute auto-deletion now that customer has opened/accessed the link!
    if (customerTgId) {
      markUserMessagesAsRead(customerTgId, orderId);
    }

    // Ultra-fast HTTP 302 Redirect (<1ms)
    if (typeof res.redirect === 'function') {
      return res.redirect(targetUrl);
    } else {
      res.writeHead(302, { Location: targetUrl });
      return res.end();
    }
  }

  // Get active bot configuration & status for Admin Panel (Admin only)
  if (req.method === 'GET' && (action === 'get-bot-config' || action === 'info')) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const cfg = await getActiveBotConfig();
      const appUrl = getAppUrl(req);
      const expectedWebhook = `${appUrl}/api/telegram/bot?botId=${cfg.botId || 'bot_8923608774'}`;
      // Fast cached webhook info (<0.1ms) - refresh asynchronously in background
      let hookData = _cachedWebhookData;
      if (!hookData || (Date.now() - _cachedWebhookDataTime > 60000)) {
        callTelegram('getWebhookInfo').then(info => {
          if (info && info.ok && info.result) {
            _cachedWebhookData = info.result;
            _cachedWebhookDataTime = Date.now();
          }
        }).catch(() => {});
        if (!hookData) {
          hookData = { url: expectedWebhook, pending_update_count: 0 };
        }
      }

      const token = cfg.token || '';
      const maskedToken = token.length > 10 ? `${token.slice(0, 6)}...${token.slice(-4)}` : '***';
      const allUsers = await getAllBotUsers();
      const connectedBotsList = getConnectedBots();
      const botCounts = {};
      connectedBotsList.forEach(b => {
        botCounts[b.botId] = allUsers.filter(u => doesUserBelongToFleetBot(u, b, connectedBotsList)).length;
      });

      // Background asynchronous profile enrichment (never delays HTTP response)
      setTimeout(async () => {
        try {
          const currentAdmins = getAdminChatIds();
          const store = readBotStore();
          if (!store.adminProfiles) store.adminProfiles = {};
          let adminProfilesModified = false;
          for (const aid of currentAdmins) {
            const cleanAid = String(aid).trim();
            if (!cleanAid) continue;
            if (!store.adminProfiles[cleanAid] || !store.adminProfiles[cleanAid].username) {
              for (const b of connectedBotsList) {
                if (!b.token) continue;
                try {
                  const res = await callTelegram('getChat', { chat_id: cleanAid }, b.token);
                  if (res && res.ok && res.result) {
                    const r = res.result;
                    const realFirst = r.first_name || '';
                    const realLast = r.last_name || '';
                    const realUname = (r.username || '').replace('@', '');
                    const realName = [realFirst, realLast].filter(Boolean).join(' ').trim();
                    store.adminProfiles[cleanAid] = {
                      id: cleanAid,
                      name: realName || (cleanAid === '6966868142' ? 'Ghost Layer' : `Admin #${cleanAid}`),
                      username: realUname || (cleanAid === '6966868142' ? 'GhostLayer73' : ''),
                      badge: '🛡️ ADMIN',
                      role: 'Order Proof Alerts & Instant Approve/Reject Buttons Across All Bots',
                      updatedAt: Date.now()
                    };
                    adminProfilesModified = true;
                    break;
                  }
                } catch (_) {}
              }
            }
          }
          if (adminProfilesModified) {
            writeBotStore(store);
          }
        } catch (_) {}
      }, 0);

        return res.status(200).json({
          ok: true,
          bot: {
            username: cfg.username || '',
            name: cfg.name || 'LinkAdda Bot',
            id: cfg.botId || '',
            source: cfg.source || 'database',
            maskedToken,
            lastActivatedAt: cfg.lastActivatedAt
          },
          bots: connectedBotsList.map(b => ({
            ...b,
            status: b.status === 'inactive' ? 'inactive' : 'active',
            subscribersCount: botCounts[b.botId] || (b.isPrimary ? allUsers.length : 0),
            maskedToken: b.token && b.token.length > 10 ? `${b.token.slice(0, 6)}...${b.token.slice(-4)}` : '***'
          })),
          webhook: hookData,
          admins: currentAdmins,
          adminProfiles: store.adminProfiles || {},
          users: allUsers,
          usersCount: allUsers.length,
          appUrl
        });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Get all connected bots fleet (Admin only)
  if (req.method === 'GET' && (action === 'get-bots' || action === 'bots')) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    const allUsers = await getAllBotUsers();
    const connectedBotsList = getConnectedBots();
    const botCounts = {};
    connectedBotsList.forEach(b => {
      botCounts[b.botId] = allUsers.filter(u => doesUserBelongToFleetBot(u, b, connectedBotsList)).length;
    });

    return res.status(200).json({
      ok: true,
      bots: connectedBotsList.map(b => ({
        ...b,
        status: b.status === 'inactive' ? 'inactive' : 'active',
        subscribersCount: botCounts[b.botId] || (b.isPrimary ? allUsers.length : 0),
        maskedToken: b.token && b.token.length > 10 ? `${b.token.slice(0, 6)}...${b.token.slice(-4)}` : '***'
      })),
      admins: getAdminChatIds()
    });
  }

  // Get all registered bot users / subscribers (Admin only)
  if (req.method === 'GET' && (action === 'get-users' || action === 'users')) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const users = await getAllBotUsers();
      return res.status(200).json({ ok: true, users, totalCount: users.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Record a Telegram user who visited WebApp or started bot
  if (req.method === 'POST' && (action === 'record-user' || (req.body && req.body.action === 'record-user'))) {
    try {
      const u = req.body || {};
      const uid = u.id || u.telegramUserId;
      if (uid) {
        const targetBotId = u.sourceBotId || u.botId || u.source_bot_id || url.searchParams.get('botId') || null;
        await recordBotUser({
          id: uid,
          username: u.username || u.telegramUsername || '',
          first_name: u.first_name || u.firstName || u.name || '',
          last_name: u.last_name || u.lastName || '',
          botId: targetBotId
        }, u.source || 'mini_app_visit', targetBotId);

        // Customer opened WebApp -> Mark unread messages as READ (2-minute auto-delete starts)
        markUserMessagesAsRead(uid);
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(200).json({ ok: false, error: e.message });
    }
  }

  // Broadcast custom message to all subscribers (Admin only)
  if (req.method === 'POST' && (action === 'broadcast-message' || (req.body && req.body.action === 'broadcast-message'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const payload = req.body || {};
      const bcRes = await broadcastCustomMessage(payload);
      return res.status(bcRes.ok ? 200 : 400).json(bcRes);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Connect & Add a New Telegram Bot into Fleet (Admin only)
  if (req.method === 'POST' && (action === 'add-bot' || (req.body && req.body.action === 'add-bot'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { token } = req.body || {};
      const cleanToken = String(token || '').trim();
      if (!cleanToken || !cleanToken.includes(':')) {
        return res.status(400).json({ ok: false, error: 'Invalid Bot Token format. Tokens look like 123456789:ABC...' });
      }

      // Live verify token against Telegram official Bot API
      const meRes = await callTelegram('getMe', {}, cleanToken);
      if (!meRes || !meRes.ok || !meRes.result) {
        return res.status(400).json({ ok: false, error: meRes?.description || 'Telegram Bot API rejected this token. Please check @BotFather.' });
      }

      const tgInfo = meRes.result;
      const botId = `bot_${tgInfo.id}`;
      const appUrl = getAppUrl(req);
      const webhookUrl = `${appUrl}/api/telegram/bot?botId=${botId}`;

      // Automatically register webhook for this new bot
      await callTelegram('setWebhook', {
        url: webhookUrl,
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query']
      }, cleanToken);

      // Bind WebApp Menu Button with bot identification
      const storeWebUrl = `${appUrl}?botId=${botId}&botUser=${encodeURIComponent(tgInfo.username || '')}`;
      await callTelegram('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: '🛍️ Open Store',
          web_app: { url: storeWebUrl }
        }
      }, cleanToken).catch(() => {});

      // Register default slash commands
      await callTelegram('setMyCommands', {
        commands: [
          { command: 'start', description: 'Start Store & Open VIP Collections' },
          { command: 'help', description: '24/7 VIP Customer Support' }
        ]
      }, cleanToken).catch(() => {});

      const newBot = {
        id: String(tgInfo.id),
        botId,
        token: cleanToken,
        username: tgInfo.username || '',
        name: tgInfo.first_name || 'LinkAdda Bot',
        status: 'active',
        isPrimary: false,
        createdAt: Date.now(),
        lastActivatedAt: new Date().toISOString()
      };

      const saved = await saveConnectedBot(newBot);
      return res.status(200).json({
        ok: true,
        bot: saved,
        bots: getConnectedBots().map(b => ({
          ...b,
          maskedToken: b.token && b.token.length > 10 ? `${b.token.slice(0, 6)}...${b.token.slice(-4)}` : '***'
        }))
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Set a Connected Bot as Primary Active Bot in Fleet (Admin only)
  if (req.method === 'POST' && (action === 'set-primary-bot' || (req.body && req.body.action === 'set-primary-bot'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { botId } = req.body || {};
      const store = readBotStore();
      if (!store.bots) store.bots = {};
      const target = getBotByIdOrToken(botId);
      if (!target) return res.status(404).json({ ok: false, error: 'Bot not found in fleet' });

      Object.values(store.bots).forEach(b => {
        b.isPrimary = (b.botId === target.botId || b.id === target.id);
      });

      target.isPrimary = true;
      target.status = 'active';
      store.bots[target.botId] = target;
      store.activeToken = target.token;
      store.bot = {
        username: target.username,
        name: target.name,
        id: target.id,
        source: 'database',
        lastActivatedAt: new Date().toISOString()
      };

      writeBotStore(store);
      cachedBotConfig = null;
      await syncBotsToSupabase(store.bots);

      // Re-register webhook for primary bot with dedicated botId
      const appUrl = getAppUrl(req);
      const webhookUrl = `${appUrl}/api/telegram/bot?botId=${target.botId}`;
      await callTelegram('setWebhook', {
        url: webhookUrl,
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query']
      }, target.token).catch(() => {});
      const storeWebUrl = `${appUrl}?botId=${target.botId}&botUser=${encodeURIComponent(target.username || '')}`;
      await callTelegram('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: '🛍️ Open Store',
          web_app: { url: storeWebUrl }
        }
      }, target.token).catch(() => {});

      return res.status(200).json({
        ok: true,
        bot: target,
        bots: getConnectedBots().map(b => ({
          ...b,
          maskedToken: b.token && b.token.length > 10 ? `${b.token.slice(0, 6)}...${b.token.slice(-4)}` : '***'
        }))
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Per-Bot Active / Inactive Status Toggle (Admin only)
  if (req.method === 'POST' && (action === 'toggle-bot-status' || (req.body && req.body.action === 'toggle-bot-status'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { botId, status, notifyUsers, noticeMessage } = req.body || {};
      const result = await toggleBotStatus(botId, status, notifyUsers, noticeMessage);
      return res.status(200).json({
        ok: true,
        ...result,
        bots: getConnectedBots().map(b => ({
          ...b,
          maskedToken: b.token && b.token.length > 10 ? `${b.token.slice(0, 6)}...${b.token.slice(-4)}` : '***'
        }))
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Delete a Connected Bot (Admin only)
  if (req.method === 'POST' && (action === 'delete-bot' || (req.body && req.body.action === 'delete-bot'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { botId } = req.body || {};
      const target = getBotByIdOrToken(botId);
      if (target?.isPrimary) {
        return res.status(400).json({ ok: false, error: 'Cannot delete primary default bot. You can toggle its status or switch primary first.' });
      }
      await removeConnectedBot(botId);
      return res.status(200).json({
        ok: true,
        bots: getConnectedBots().map(b => ({
          ...b,
          maskedToken: b.token && b.token.length > 10 ? `${b.token.slice(0, 6)}...${b.token.slice(-4)}` : '***'
        }))
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Test Ping from a Specific Bot in Fleet (Admin only)
  if (req.method === 'POST' && (action === 'test-bot-ping' || (req.body && req.body.action === 'test-bot-ping'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { botId, chatId } = req.body || {};
      const bot = getBotByIdOrToken(botId);
      if (!bot || !bot.token) {
        return res.status(404).json({ ok: false, error: 'Bot not found or token missing' });
      }
      const adminIds = getAdminChatIds();
      const targetChat = chatId || adminIds[0];
      if (!targetChat) {
        return res.status(400).json({ ok: false, error: 'No admin chat ID found to test' });
      }
      const pingRes = await callTelegram('sendMessage', {
        chat_id: targetChat,
        text: `🔔 <b>Fleet Bot Ping Test:</b> @${bot.username || 'Bot'} is connected and delivering alerts properly!`,
        parse_mode: 'HTML'
      }, bot.token);
      return res.status(pingRes?.ok ? 200 : 400).json({ ok: Boolean(pingRes?.ok), result: pingRes });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Real Telegram Admin: Add New Admin Chat ID (Admin only)
  if (req.method === 'POST' && (action === 'add-admin' || (req.body && req.body.action === 'add-admin'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { chatId, label, assignedBotId, assignedBotUsername } = req.body || {};
      const result = await addAdminChatId(chatId, label, assignedBotId, assignedBotUsername);
      return res.status(200).json({ ok: true, ...result });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  }

  // Real Telegram Admin: Remove Admin Chat ID (Admin only)
  if (req.method === 'POST' && (action === 'remove-admin' || (req.body && req.body.action === 'remove-admin'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { chatId } = req.body || {};
      const result = await removeAdminChatId(chatId);
      return res.status(200).json({ ok: true, ...result });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  }

  // Lookup Telegram User info by Numeric ID across all fleet bots (Admin only)
  if (action === 'lookup-tg-user' || (req.body && req.body.action === 'lookup-tg-user')) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    const targetId = String(url.searchParams.get('id') || req.body?.id || '').trim();
    if (!targetId) return res.status(400).json({ ok: false, error: 'id parameter is required' });

    const store = readBotStore();
    if (store.adminProfiles?.[targetId]) {
      const p = store.adminProfiles[targetId];
      if (p.name && !p.name.startsWith('Admin #')) {
        return res.status(200).json({ ok: true, found: true, source: 'adminProfiles', user: p });
      }
    }
    if (store.users?.[targetId]) {
      const u = store.users[targetId];
      const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.name || '';
      if (fullName || u.username) {
        return res.status(200).json({
          ok: true,
          found: true,
          source: 'users',
          user: { id: targetId, name: fullName, username: u.username || '' }
        });
      }
    }

    const allFleetBots = getConnectedBots();
    for (const b of allFleetBots) {
      if (!b.token) continue;
      try {
        const res = await callTelegram('getChat', { chat_id: targetId }, b.token);
        if (res && res.ok && res.result) {
          const r = res.result;
          const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
          const uname = (r.username || '').replace('@', '');
          const profile = {
            id: targetId,
            name: fullName || uname || `User #${targetId}`,
            username: uname,
            source: 'telegram_api',
            botUsername: b.username
          };
          return res.status(200).json({ ok: true, found: true, user: profile });
        }
      } catch (_) {}
    }

    return res.status(200).json({
      ok: true,
      found: false,
      error: 'chat_not_found',
      message: 'User has not started any bot yet.'
    });
  }

  // Real Telegram Admin: Update Admin Profile Name & Username (Admin only)
  if (req.method === 'POST' && (action === 'update-admin-profile' || (req.body && req.body.action === 'update-admin-profile'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { chatId, name, username, badge, assignedBotId, assignedBotUsername } = req.body || {};
      const cleanId = String(chatId || '').trim();
      if (!cleanId) return res.status(400).json({ ok: false, error: 'chatId is required' });
      const store = readBotStore();
      if (!store.adminProfiles) store.adminProfiles = {};
      const existing = store.adminProfiles[cleanId] || {};
      const resolvedBotId = assignedBotId !== undefined ? assignedBotId : (existing.assignedBotId || 'all');
      const resolvedBotUname = assignedBotUsername !== undefined ? assignedBotUsername : (existing.assignedBotUsername || 'All Fleet Bots');
      store.adminProfiles[cleanId] = {
        ...existing,
        id: cleanId,
        name: (name || '').trim() || existing.name || `Admin #${cleanId}`,
        username: (username || '').replace('@', '').trim(),
        badge: badge || existing.badge || '🛡️ ADMIN',
        assignedBotId: resolvedBotId,
        assignedBotUsername: resolvedBotUname,
        role: resolvedBotId && resolvedBotId !== 'all' ? `Admin for @${resolvedBotUname || resolvedBotId}` : 'Order Proof Alerts & Instant Approve/Reject Buttons Across All Bots',
        updatedAt: Date.now()
      };
      writeBotStore(store);

      try {
        const { url, key } = getSupabaseConfig();
        await fetch(`${url}/rest/v1/site_settings`, {
          method: 'POST',
          headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify([{ key: 'tg_admin_profiles', value: store.adminProfiles, updated_at: new Date().toISOString() }])
        });
      } catch (_) {}

      return res.status(200).json({ ok: true, adminProfiles: store.adminProfiles, admin: store.adminProfiles[cleanId] });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  }

  // Real Telegram Admin: Direct Ping to a Specific Admin (Admin only)
  if (req.method === 'POST' && (action === 'ping-admin' || (req.body && req.body.action === 'ping-admin'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { chatId } = req.body || {};
      if (!chatId) return res.status(400).json({ ok: false, error: 'Missing chatId' });
      const pingRes = await callTelegram('sendMessage', {
        chat_id: chatId,
        text: `👑 <b>LinkAdda Admin Ping Test</b>\n\nYour Admin Telegram ID is actively connected and authorized for LinkAdda Online!`,
        parse_mode: 'HTML'
      });
      return res.status(pingRes?.ok ? 200 : 400).json({ ok: Boolean(pingRes?.ok), result: pingRes });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Hot-Swap: Switch to a new Telegram bot instantly (Admin only)
  if (req.method === 'POST' && (action === 'switch-bot' || (req.body && req.body.action === 'switch-bot'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { token, adminUser } = req.body || {};
      const result = await switchTelegramBot(token, adminUser || 'Admin Panel', req);
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Test notification: Fire alert to all admins via active bot (Admin only)
  if (req.method === 'POST' && (action === 'test-bot' || (req.body && req.body.action === 'test-bot'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const cfg = await getActiveBotConfig();
      const adminIds = getAdminChatIds();
      let sentCount = 0;
      for (const adminId of adminIds) {
        const testRes = await callTelegram('sendMessage', {
          chat_id: adminId,
          text: 
            `🔔 <b>LinkAdda Admin Test Notification</b>\n\n` +
            `Bot @${cfg.username || 'Active Bot'} is connected, online, and delivering alerts properly!`,
          parse_mode: 'HTML'
        });
        if (testRes?.ok) sentCount++;
      }
      return res.status(200).json({ ok: true, sentCount, totalAdmins: adminIds.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }


  // Manual Trigger: Order Notification
  if (req.method === 'POST' && (action === 'notify-order' || url.pathname.endsWith('/notify-order'))) {
    try {
      const order = req.body || {};
      const orderId = String(order.order_id || order.id || order.orderId || '').trim();

      // 1. Guaranteed server-side order upsert to Supabase with Service Role Key
      if (orderId) {
        try {
          const { url: sbUrl, key: sbKey } = getSupabaseConfig();
          const rawAmt = order.numericAmount || String(order.amount || '').replace(/[^0-9.]/g, '');
          const cleanAmt = Number(rawAmt) || 0;
          const prodTitle = order.product_title || order.productTitle || order.productName || order.title || order.name || 'VIP Pack';
          const method = order.payment_method || order.method || 'UPI / QR';
          const proof = order.payment_proof || order.screenshotUrl || '';
          const utr = order.utr || order.transactionId || '';
          const custName = order.customer_name || order.customerName || order.name || order.buyerName || (order.telegramUsername ? `@${order.telegramUsername}` : 'Customer');

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
              paymentMethod: method,
              paymentProof: proof,
              utr,
              status: order.status || 'pending',
              timestamp: Date.now()
            },
            updated_at: new Date().toISOString()
          };

          await fetch(`${sbUrl}/rest/v1/orders`, {
            method: 'POST',
            headers: {
              'apikey': sbKey,
              'Authorization': `Bearer ${sbKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify([orderRow])
          });
        } catch (dbErr) {
          console.warn('Server-side order upsert notice in notify-order:', dbErr.message);
        }
      }

      const tgId = order.telegramUserId || (order.data && (order.data.telegramUserId || order.data.telegram_user_id));
      if (tgId) {
        const orderBotId = order.sourceBotId || order.source_bot_id || (order.data && (order.data.sourceBotId || order.data.source_bot_id || order.data.botId)) || null;
        recordBotUser({
          id: tgId,
          username: order.telegramUsername || (order.data && (order.data.telegramUsername || order.data.telegram)) || '',
          first_name: order.customerName || order.name || (order.data && (order.data.customerName || order.data.name)) || 'Telegram Buyer',
          botId: orderBotId
        }, 'order_checkout', orderBotId).catch(() => {});
      }
      const notifyRes = await notifyAdminsNewOrder(order);
      return res.status(200).json(notifyRes);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Manual Trigger: Broadcast New Product (Admin only)
  if (req.method === 'POST' && (action === 'broadcast' || url.pathname.endsWith('/broadcast'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const body = req.body || {};
      const product = body.product || body;
      const targetBotIds = body.targetBotIds || (body.product && body.product.targetBotIds) || ['all'];
      const bcRes = await broadcastNewProduct(product, targetBotIds);
      return res.status(200).json(bcRes);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Manual Trigger: Approve Order (e.g. from Admin Panel - Admin only)
  if (req.method === 'POST' && (action === 'approve-order' || (req.body && req.body.action === 'approve-order'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { orderId, adminUser } = req.body || {};
      if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
      const result = await processOrderApproval(orderId, adminUser || { first_name: 'Admin Panel', username: 'admin' });
      return res.status(200).json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Manual Trigger: Reject Order (e.g. from Admin Panel - Admin only)
  if (req.method === 'POST' && (action === 'reject-order' || (req.body && req.body.action === 'reject-order'))) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    try {
      const { orderId, adminUser } = req.body || {};
      if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
      const result = await processOrderRejection(orderId, adminUser || { first_name: 'Admin Panel', username: 'admin' });
      return res.status(200).json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Official Telegram Webhook Receiver
  if (req.method === 'POST') {
    try {
      const update = req.body || {};

      // 1. Resolve bot identifier with maximum precision (query param, path, or command mention)
      let webhookBotId = url.searchParams.get('botId') || url.searchParams.get('bot_id');
      if (!webhookBotId) {
        const pathMatch = url.pathname.match(/\/api\/telegram\/bot\/(bot_[a-zA-Z0-9_-]+|[0-9]+)/i);
        if (pathMatch) webhookBotId = pathMatch[1];
      }
      if (!webhookBotId && update.message?.text) {
        const cmdMatch = update.message.text.match(/^\/[a-zA-Z0-9_]+@([a-zA-Z0-9_]+)/i);
        if (cmdMatch) webhookBotId = cmdMatch[1];
      }

      // 2. Lookup receiving bot in fleet
      await syncBotsFromSupabase().catch(() => {});
      let receivingBot = webhookBotId ? getBotByIdOrToken(webhookBotId) : null;
      if (!receivingBot && webhookBotId) {
        await syncBotsFromSupabase(true).catch(() => {});
        receivingBot = getBotByIdOrToken(webhookBotId);
      }
      if (!receivingBot) {
        receivingBot = getBotByIdOrToken();
      }

      const currentToken = receivingBot?.token || null;
      const currentBotId = receivingBot?.botId || null;
      const currentBotUsername = receivingBot?.username || '';

      // Maintenance notice if bot is marked inactive
      if (receivingBot && receivingBot.status === 'inactive') {
        if (update.message?.chat?.id) {
          await callTelegram('sendMessage', {
            chat_id: update.message.chat.id,
            text: '⚠️ <b>Bot Maintenance Notice:</b> This bot is temporarily offline for maintenance. Please access our store directly at https://linkadda-online.onrender.com or contact support.',
            parse_mode: 'HTML'
          }, currentToken).catch(() => {});
        }
        return res.status(200).json({ ok: true, notice: 'bot_inactive' });
      }

      // 1. Handle Messages (e.g. /start or incoming chat)
      if (update.message) {
        const msg = update.message;
        const text = (msg.text || '').trim();
        const fromUser = msg.from;
        const adminIds = getAdminChatIds();

        if (fromUser) {
          const isStartCmd = text === '/start' || text.startsWith('/start');
          await recordBotUser(fromUser, isStartCmd ? 'bot_start' : 'bot_chat', currentBotId).catch(() => {});

          // Auto-sync real Telegram Admin profile if sender is an admin!
          const fromIdStr = String(fromUser.id);
          if (adminIds.includes(fromIdStr)) {
            const store = readBotStore();
            if (!store.adminProfiles) store.adminProfiles = {};
            const realFirst = fromUser.first_name || '';
            const realLast = fromUser.last_name || '';
            const realUname = (fromUser.username || '').replace('@', '');
            const realName = [realFirst, realLast].filter(Boolean).join(' ').trim() || `Admin #${fromIdStr}`;
            store.adminProfiles[fromIdStr] = {
              ...(store.adminProfiles[fromIdStr] || {}),
              id: fromIdStr,
              name: realName,
              username: realUname,
              badge: (fromIdStr === '8802192472') ? '👑 OWNER' : '🛡️ ADMIN',
              role: 'Order Proof Alerts & Instant Approve/Reject Buttons Across All Bots',
              updatedAt: Date.now()
            };
            writeBotStore(store);

            try {
              const { url, key } = getSupabaseConfig();
              fetch(`${url}/rest/v1/site_settings`, {
                method: 'POST',
                headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
                body: JSON.stringify([{ key: 'tg_admin_profiles', value: store.adminProfiles, updated_at: new Date().toISOString() }])
              }).catch(() => {});
            } catch (_) {}
          }
        }

        // ⚡ User entered bot / sent message -> Trigger 2-minute auto-delete on any unread VIP messages!
        if (msg.chat && msg.chat.id) {
          markUserMessagesAsRead(msg.chat.id);
        }

        if (text === '/start' || text.startsWith('/start')) {
          const payload = text.replace(/^\/start(?:@[a-zA-Z0-9_]+)?\s*/i, '').trim();
          const appUrl = getAppUrl(req);
          const botParam = currentBotId ? `botId=${encodeURIComponent(currentBotId)}&botUser=${encodeURIComponent(receivingBot?.username || '')}` : '';
          const storeWebUrl = botParam ? `${appUrl}?${botParam}` : appUrl;

          if (payload) {
            // User opened bot via deep link for a specific product e.g. /start prod_123
            const productViewUrl = `${appUrl}/index.html?productId=${encodeURIComponent(payload)}${botParam ? `&${botParam}` : ''}`;
            const checkoutUrl = `${appUrl}/payment.html?productId=${encodeURIComponent(payload)}${botParam ? `&${botParam}` : ''}`;
            const safeName = escapeTelegramHtml(payload.replace(/[-_]+/g, ' '));

            await callTelegram('sendMessage', {
              chat_id: msg.chat.id,
              text:
                `👋 <b>Welcome ${escapeTelegramHtml(fromUser.first_name || 'VIP Member')}!</b>\n\n` +
                `🔥 You requested VIP Item: <b>${safeName}</b>\n\n` +
                `Tap <b>View Product</b> to check full details & demo inside Telegram, or <b>Buy Now</b> to unlock access instantly:`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '👀 View Product (Photos & Demo)', web_app: { url: productViewUrl } }],
                  [{ text: '⚡ Buy Now & Unlock Access', web_app: { url: checkoutUrl } }],
                  [{ text: '🛍️ Open VIP Store', web_app: { url: storeWebUrl } }],
                  [{ text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }]
                ]
              }
            }, currentToken);
            return res.status(200).json({ ok: true });
          }

          const isAdminSender = adminIds.includes(String(msg.chat.id));
          const welcomeText = 
            `👋 <b>Welcome ${escapeTelegramHtml(fromUser.first_name || 'VIP Member')}!</b>\n\n` +
            (isAdminSender ? `👑 <b>Administrator Mode Active!</b> Order alerts & approve/reject buttons are connected.\n\n` : '') +
            `🆔 <b>Your Telegram Chat ID:</b> <code>${msg.chat.id}</code>\n\n` +
            `🔥 Welcome to <b>LinkAdda Online Store</b>!\n\n` +
            `Explore all Exclusive VIP Packs & Collections:\n` +
            `⚡ Instant High-Speed Cloud Access\n` +
            `🔒 100% Discrete & Anonymous Checkout\n` +
            `🛡️ Lifetime Free Link Replacement Guarantee\n\n` +
            `Tap the <b>Open Store</b> button below to begin shopping:`;

          await callTelegram('sendMessage', {
            chat_id: msg.chat.id,
            text: welcomeText,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🛍️ Open Store (VIP Content)', web_app: { url: storeWebUrl } }],
                [{ text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }]
              ]
            }
          }, currentToken);
          return res.status(200).json({ ok: true });
        }
      }

      // 2. Handle Inline Button Clicks (Customer View Link OR Admin Approve/Reject)
      if (update.callback_query) {
        const cq = update.callback_query;
        const data = cq.data || '';
        const user = cq.from;
        const adminUser = user;
        const userIdStr = String(user.id);
        const authorizedAdmins = getAdminChatIds();

        // ⚡ User clicked any inline button -> Record user & trigger 2-minute auto-delete on any unread VIP messages!
        if (user && user.id) {
          await recordBotUser(user, 'inline_interaction', currentBotId).catch(() => {});
          markUserMessagesAsRead(user.id);
        }

        // ── A. Customer Click: Unlock & View VIP Link (Method A: 2-Minute Self-Destruct Timer) ──
        if (data.startsWith('view_link_')) {
          const orderId = data.replace('view_link_', '');
          const store = readBotStore();
          const linkInfo = store.orderLinks?.[orderId] || {};
          const channelLink = linkInfo.channelLink || '';
          const productTitle = linkInfo.productTitle || 'VIP Pack';

          if (!channelLink) {
            await callTelegram('answerCallbackQuery', {
              callback_query_id: cq.id,
              text: '⚠️ Link expired or not found. Please contact support @VIP_KINK.',
              show_alert: true
            }, currentToken);
            return res.status(200).json({ ok: true });
          }

          // User just read/opened the link! Trigger 2-minute timer notice
          await callTelegram('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: '⏳ Link Unlocked! This message will automatically self-destruct in 2 minutes.',
            show_alert: true
          }, currentToken);

          const revealedText = 
            `🎉 <b>Your Order #${orderId} VIP Access Link</b>\n\n` +
            `📦 <b>Product:</b> ${escapeTelegramHtml(productTitle)}\n\n` +
            `🔗 <b>VIP Access Link:</b>\n` +
            `👉 <b>${channelLink}</b>\n\n` +
            `⏳ <b>SELF-DESTRUCT ACTIVE:</b>\n` +
            `This message will be <b>permanently deleted in 2 minutes</b> from this chat!\n\n` +
            `💬 24/7 Lifetime Replacement: @VIP_KINK`;

          if (cq.message) {
            await callTelegram('editMessageText', {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text: revealedText,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🚀 Join / Access VIP Link Now', url: channelLink }],
                  [{ text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }]
                ]
              }
            }, currentToken);

            // Schedule deletion after exactly 120 seconds (2 minutes)
            markUserMessagesAsRead(cq.message.chat.id, orderId);
            scheduleMessageDeletion(cq.message.chat.id, cq.message.message_id, 120);
          }

          return res.status(200).json({ ok: true });
        }

        // ── B. No-op button click (already processed) ──
        if (data === 'noop') {
          await callTelegram('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: 'ℹ️ This order has already been verified & processed.'
          }, currentToken);
          return res.status(200).json({ ok: true });
        }

        // ── C. Admin Only Clicks (Approve / Reject) ──
        const isAuthorizedAdmin = authorizedAdmins.includes(userIdStr) || 
                                 (cq.message?.chat?.id && authorizedAdmins.includes(String(cq.message.chat.id)));

        if (!isAuthorizedAdmin) {
          await callTelegram('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: '⚠️ You are not an authorized Admin for this bot!',
            show_alert: true
          }, currentToken);
          return res.status(200).json({ ok: true });
        }

        if (data.startsWith('appr_')) {
          const orderId = data.replace('appr_', '');
          await callTelegram('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: `✅ Order #${orderId} Approved!`
          }, currentToken);

          // Ensure this specific admin message is tracked in store
          if (cq.message && cq.message.chat) {
            try {
              const store = readBotStore();
              if (!store.orderAdminMessages) store.orderAdminMessages = {};
              if (!store.orderAdminMessages[orderId]) store.orderAdminMessages[orderId] = [];
              const exists = store.orderAdminMessages[orderId].some(m => String(m.chatId) === String(cq.message.chat.id) && String(m.messageId) === String(cq.message.message_id));
              if (!exists) {
                store.orderAdminMessages[orderId].push({
                  chatId: String(cq.message.chat.id),
                  messageId: cq.message.message_id,
                  isPhoto: Boolean(cq.message.photo),
                  caption: cq.message.caption || cq.message.text || `🚨 Order #${orderId}`,
                  sentAt: Date.now()
                });
                writeBotStore(store);
              }
            } catch (_) {}
          }

          await processOrderApproval(orderId, adminUser);
          return res.status(200).json({ ok: true });
        }

        if (data.startsWith('rejc_')) {
          const orderId = data.replace('rejc_', '');
          await callTelegram('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: `❌ Order #${orderId} Rejected!`
          }, currentToken);

          // Ensure this specific admin message is tracked in store
          if (cq.message && cq.message.chat) {
            try {
              const store = readBotStore();
              if (!store.orderAdminMessages) store.orderAdminMessages = {};
              if (!store.orderAdminMessages[orderId]) store.orderAdminMessages[orderId] = [];
              const exists = store.orderAdminMessages[orderId].some(m => String(m.chatId) === String(cq.message.chat.id) && String(m.messageId) === String(cq.message.message_id));
              if (!exists) {
                store.orderAdminMessages[orderId].push({
                  chatId: String(cq.message.chat.id),
                  messageId: cq.message.message_id,
                  isPhoto: Boolean(cq.message.photo),
                  caption: cq.message.caption || cq.message.text || `🚨 Order #${orderId}`,
                  sentAt: Date.now()
                });
                writeBotStore(store);
              }
            } catch (_) {}
          }

          await processOrderRejection(orderId, adminUser);
          return res.status(200).json({ ok: true });
        }
      }

      return res.status(200).json({ ok: true });
    } catch (webhookErr) {
      console.error('Telegram webhook processing error:', webhookErr);
      return res.status(200).json({ ok: false, error: webhookErr.message });
    }
  }

  return res.status(200).json({ ok: true, message: 'LinkAdda Telegram Bot Endpoint Ready' });
}

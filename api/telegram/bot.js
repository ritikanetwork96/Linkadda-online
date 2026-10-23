import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleCors, verifyAdminRequest } from '../_utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_ADMIN_IDS = ['8802192472', '6966868142'];

export function getAdminChatIds() {
  const envAdmins = (process.env.ADMIN_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const combined = [...new Set([...DEFAULT_ADMIN_IDS, ...envAdmins])];
  return combined;
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
  const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeGl3ZnN3bmJhY21wanhxZ3NuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjYwNzE4NCwiZXhwIjoyMTA4MTgzMTg0fQ.pOuhgVqu-dASRMvqd7cMMzcAMuufanIJG_Jdu-G2T-Y';
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || SERVICE_ROLE_KEY).trim();
  return { url, key };
}

// ── Ultra-Fast Local-First Storage Engine (bot_store.json) ──────────────────────
function getBotStorePath() {
  const p1 = path.resolve(__dirname, '../../data/bot_store.json');
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(process.cwd(), 'data', 'bot_store.json');
  return p2;
}

function readBotStore() {
  try {
    const filePath = getBotStorePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Local bot_store.json read note:', err.message);
  }
  return {
    activeToken: process.env.TELEGRAM_BOT_TOKEN || '8923608774:AAFhvO4Yzly7toIf5qoI-TSW4EzVzWCdVlE',
    bot: {
      username: 'Myshop9876_bot',
      name: 'LinkAdda Store Bot',
      id: '8923608774',
      source: 'database',
      lastActivatedAt: new Date().toISOString()
    },
    admins: DEFAULT_ADMIN_IDS,
    users: {},
    pendingDeletions: {},
    orderLinks: {}
  };
}

function writeBotStore(data) {
  try {
    const filePath = getBotStorePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Local bot_store.json write error:', err.message);
    return false;
  }
}

// In-memory cache for ultra-speed active bot config
let cachedBotConfig = null;
let lastBotCacheFetch = 0;
const BOT_CACHE_TTL_MS = 5000;

/**
 * Fetch currently active bot token instantly (<0.1ms) from local store
 */
export async function getActiveBotConfig(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedBotConfig && (now - lastBotCacheFetch < BOT_CACHE_TTL_MS)) {
    return cachedBotConfig;
  }

  const store = readBotStore();
  const token = (store.activeToken || process.env.TELEGRAM_BOT_TOKEN || '8923608774:AAFhvO4Yzly7toIf5qoI-TSW4EzVzWCdVlE').trim();
  const b = store.bot || {};

  cachedBotConfig = {
    token,
    username: b.username || 'Myshop9876_bot',
    name: b.name || 'LinkAdda Store Bot',
    botId: String(b.id || '8923608774'),
    source: b.source || 'database',
    lastActivatedAt: b.lastActivatedAt || null,
    updatedAt: now
  };
  lastBotCacheFetch = now;
  return cachedBotConfig;
}

/**
 * Call official Telegram Bot API with 5-second hard timeout
 */
export async function callTelegram(method, body = {}, overrideToken = null) {
  try {
    let token = overrideToken;
    if (!token) {
      const cfg = await getActiveBotConfig();
      token = cfg.token;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    });
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
  const appUrl = getAppUrl(req);
  const webhookUrl = `${appUrl}/api/telegram/bot`;

  // 2. Set Webhook on Telegram for this new bot
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

  // 3. Set WebApp Menu Button ("Open Store")
  await callTelegram('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: '🛍️ Open Store',
      web_app: { url: appUrl }
    }
  }, cleanToken).catch(() => {});

  // 4. Set Default Bot Commands
  await callTelegram('setMyCommands', {
    commands: [
      { command: 'start', description: 'Start Store & Open VIP Collections' },
      { command: 'help', description: '24/7 VIP Customer Support' }
    ]
  }, cleanToken).catch(() => {});

  // 5. Instantly persist to local bot_store.json (0ms lag)
  const store = readBotStore();
  store.activeToken = cleanToken;
  store.bot = {
    username: botUser.username || '',
    name: botUser.first_name || '',
    id: String(botUser.id || ''),
    source: 'hot_swap',
    lastActivatedAt: new Date().toISOString(),
    activatedBy: adminUser
  };
  writeBotStore(store);

  // 6. Update in-memory cache
  cachedBotConfig = {
    token: cleanToken,
    username: botUser.username || '',
    name: botUser.first_name || '',
    botId: String(botUser.id || ''),
    source: 'hot_swap',
    lastActivatedAt: Date.now(),
    updatedAt: Date.now()
  };
  lastBotCacheFetch = Date.now();

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
 * Store unique bot users in high-speed local store & async backup (0ms lag)
 */
export async function recordBotUser(fromUser, source = 'bot_interaction') {
  if (!fromUser?.id) return;
  const uidStr = String(fromUser.id);
  const adminIds = new Set(getAdminChatIds());
  if (adminIds.has(uidStr)) return; // Never mix admin accounts into subscriber directory

  const store = readBotStore();
  if (!store.users) store.users = {};

  const existing = store.users[uidStr] || {};
  store.users[uidStr] = {
    id: uidStr,
    username: fromUser.username || existing.username || '',
    firstName: fromUser.first_name || fromUser.firstName || existing.firstName || 'Telegram User',
    lastName: fromUser.last_name || fromUser.lastName || existing.lastName || '',
    source: source || existing.source || 'bot_interaction',
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  writeBotStore(store);

  // Non-blocking async push to Supabase using Service Role Key (bypasses RLS)
  (async () => {
    try {
      const { url, key } = getSupabaseConfig();
      const headers = { 
        'apikey': key, 
        'Authorization': `Bearer ${key}`, 
        'Content-Type': 'application/json', 
        'Prefer': 'resolution=merge-duplicates' 
      };
      // Send ONLY valid table columns (key, value)
      await fetch(`${url}/rest/v1/site_settings`, {
        method: 'POST',
        headers,
        body: JSON.stringify([{ key: 'tg_bot_users', value: store.users }]),
        signal: AbortSignal.timeout(3000)
      });
    } catch (_) {}
  })();
}

/**
 * Fetch all real registered bot subscribers (Admins strictly filtered out)
 * Unifies local cache, Supabase site_settings, and all Telegram customers from Orders!
 */
export async function getAllBotUsers() {
  try {
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
        fetch(`${url}/rest/v1/site_settings?key=eq.tg_bot_users&select=*`, { headers, signal: AbortSignal.timeout(4000) }).catch(() => null),
        fetch(`${url}/rest/v1/orders?select=id,order_id,created_at,status,data&order=created_at.desc&limit=500`, { headers, signal: AbortSignal.timeout(4000) }).catch(() => null)
      ]);

      if (settingsRes && settingsRes.ok) {
        const rows = await settingsRes.json();
        if (rows && rows[0] && rows[0].value && typeof rows[0].value === 'object') {
          usersMap = { ...rows[0].value, ...usersMap };
        }
      }

      if (ordersRes && ordersRes.ok) {
        const orders = await ordersRes.json();
        if (Array.isArray(orders)) {
          for (const ord of orders) {
            const data = ord.data || {};
            const rawId = data.telegramUserId || data.telegram_user_id || data.telegramId || ord.telegram_user_id || '';
            const tgId = String(rawId).trim();
            if (tgId && tgId !== 'undefined' && tgId !== 'null' && !adminIds.has(tgId)) {
              if (!usersMap[tgId]) {
                const tgUser = (data.telegramUsername || data.telegram || '').replace('@', '').trim();
                const custName = data.customerName || data.name || data.firstName || 'Telegram Buyer';
                usersMap[tgId] = {
                  id: tgId,
                  username: tgUser,
                  firstName: custName,
                  lastName: '',
                  source: 'order_checkout',
                  createdAt: new Date(ord.created_at || Date.now()).getTime(),
                  updatedAt: new Date(ord.created_at || Date.now()).getTime()
                };
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
        body: JSON.stringify([{ key: 'tg_bot_users', value: usersMap }]),
        signal: AbortSignal.timeout(3000)
      }).catch(() => {});
    } catch (sbErr) {
      console.warn('getAllBotUsers Supabase live fetch note:', sbErr.message);
    }

    const users = Object.values(usersMap).filter(u => u && u.id && !adminIds.has(String(u.id)) && u.source !== 'admin_account');
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

  const productTitle = order.product_title || order.productTitle || order.title || order.name || 'VIP Content Pack';
  
  // Format amount cleanly without double symbols
  const rawAmt = String(order.amount || order.amountDisplay || '399').trim();
  const amount = rawAmt.startsWith('₹') || rawAmt.startsWith('$') ? rawAmt : (order.currency === 'USD' ? `$${rawAmt}` : `₹${rawAmt}`);
  
  const method = order.payment_method || order.method || 'UPI / QR';
  const utr = order.utr || order.transactionId || 'Not provided';
  const tgUser = order.telegramUsername ? `@${order.telegramUsername}` : (order.telegramUserId ? `ID: ${order.telegramUserId}` : 'Website Checkout');
  
  let screenshot = order.payment_proof || order.screenshotUrl || order.paymentProof || '';
  if (screenshot) {
    screenshot = await ensureScreenshotUploaded(orderId, screenshot);
  }

  // Update Supabase order row with permanent screenshot URL if available
  if (screenshot && (screenshot.startsWith('http://') || screenshot.startsWith('https://'))) {
    try {
      const { url, key } = getSupabaseConfig();
      await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_proof: screenshot, updated_at: new Date().toISOString() })
      });
    } catch (_) {}
  }

  const caption = 
    `🚨 <b>NEW ORDER RECEIVED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🆔 <b>Order ID:</b> <code>${orderId}</code>\n` +
    `📦 <b>Product:</b> <b>${productTitle}</b>\n` +
    `💰 <b>Amount:</b> <b>${amount}</b>\n` +
    `💳 <b>Payment Method:</b> ${method}\n` +
    `🔢 <b>UTR / Transaction Ref:</b> <code>${utr}</code>\n` +
    `👤 <b>Customer:</b> ${tgUser}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Review payment screenshot and tap below to Approve or Reject:</i>`;

  const inlineKeyboard = {
    inline_keyboard: [
      ...(screenshot && (screenshot.startsWith('http://') || screenshot.startsWith('https://'))
        ? [[{ text: '🔍 View Full Screenshot', url: screenshot }]]
        : []),
      [
        { text: '✅ Approve Order', callback_data: `appr_${orderId}` },
        { text: '❌ Reject Order', callback_data: `rejc_${orderId}` }
      ]
    ]
  };

  const results = [];
  for (const adminId of adminIds) {
    if (screenshot && (screenshot.startsWith('http://') || screenshot.startsWith('https://'))) {
      const photoRes = await callTelegram('sendPhoto', {
        chat_id: adminId,
        photo: screenshot,
        caption: caption,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      });
      if (photoRes.ok) {
        results.push(photoRes);
        continue;
      }
    }

    // Fallback text message if photo fails or missing
    const textRes = await callTelegram('sendMessage', {
      chat_id: adminId,
      text: caption + (screenshot && (screenshot.startsWith('http://') || screenshot.startsWith('https://')) ? `\n\n📸 <b>Payment Proof:</b> <a href="${screenshot}">Tap to View Screenshot</a>` : ''),
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard
    });
    results.push(textRes);
  }

  // Send instant receipt / acknowledgement to customer if they ordered via Telegram WebApp
  if (order.telegramUserId) {
    await callTelegram('sendMessage', {
      chat_id: order.telegramUserId,
      text: 
        `🕒 <b>Order #${orderId} Received!</b>\n\n` +
        `📦 <b>Product:</b> ${productTitle}\n` +
        `💰 <b>Amount:</b> ${amount}\n\n` +
        `🔍 Admin is currently reviewing your payment proof and transaction reference. <b>You will receive an instant notification right here once verified.</b>\n\n` +
        `For 24/7 priority support: @VIP_KINK`,
      parse_mode: 'HTML'
    });
  }

  return { ok: true, sentTo: adminIds.length };
}

/**
 * Handle Order Approval: Update DB and Notify Customer
 */
async function processOrderApproval(orderId, adminUser) {
  const { url, key } = getSupabaseConfig();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };

  // Fetch order matching either id or order_id
  const orderRes = await fetch(`${url}/rest/v1/orders?or=(id.eq.${encodeURIComponent(orderId)},order_id.eq.${encodeURIComponent(orderId)})&select=*`, { headers });
  if (!orderRes.ok) return { ok: false, error: 'Order not found' };
  const rows = await orderRes.json();
  if (!rows || !rows.length) return { ok: false, error: 'Order not found' };
  const order = rows[0];

  // Fetch matched product to check for specific channelLink
  let channelLink = order.channel_link || order.data?.channelLink || '';
  if (!channelLink && order.product_id) {
    try {
      const pRes = await fetch(`${url}/rest/v1/products?id=eq.${encodeURIComponent(order.product_id)}&select=*`, { headers });
      if (pRes.ok) {
        const pRows = await pRes.json();
        channelLink = pRows?.[0]?.channel_link || pRows?.[0]?.data?.channelLink || '';
      }
    } catch (_) {}
  }
  if (channelLink.includes('VIP_KINK') || channelLink.includes('TRUSTED_BROTHER1234')) channelLink = '';

  const adminName = adminUser?.username ? `@${adminUser.username}` : (adminUser?.first_name || String(adminUser?.id || 'Admin'));

  const approvedData = {
    ...(order.data || {}),
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

  // Update order in Supabase (non-blocking 1.5s timeout)
  (async () => {
    try {
      await fetch(`${url}/rest/v1/orders?or=(id.eq.${encodeURIComponent(orderId)},order_id.eq.${encodeURIComponent(orderId)})`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'approved',
          updated_at: new Date().toISOString(),
          data: approvedData
        }),
        signal: AbortSignal.timeout(1500)
      });
    } catch (_) {}
  })();

  // Save order link in bot_store.json so view_link callback is 0ms instant
  try {
    const store = readBotStore();
    if (!store.orderLinks) store.orderLinks = {};
    store.orderLinks[orderId] = {
      channelLink: channelLink || '',
      productTitle: order.product_title || 'VIP Pack',
      customerTgId: order.telegram_user_id || order.data?.telegramUserId || null,
      approvedAt: Date.now()
    };
    writeBotStore(store);
  } catch (_) {}

  // Notify customer on Telegram if customer TG User ID exists
  const customerTgId = order.telegram_user_id || order.data?.telegramUserId || order.telegramUserId;
  if (customerTgId) {
    const appUrl = getAppUrl();
    const productTitle = order.product_title || order.title || order.data?.product_title || 'VIP Pack';

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

      const sendRes = await callTelegram('sendMessage', {
        chat_id: customerTgId,
        text: approvalText,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Open VIP Access Link', url: accessUrl }],
            [{ text: '🛍️ Open Store', web_app: { url: appUrl } }],
            [{ text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }]
          ]
        }
      });

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
      });
    }
  }

  return { ok: true, channelLink };
}

/**
 * Handle Order Rejection: Update DB and Notify Customer
 */
async function processOrderRejection(orderId, adminUser) {
  const { url, key } = getSupabaseConfig();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };

  // Fetch order matching either id or order_id
  const orderRes = await fetch(`${url}/rest/v1/orders?or=(id.eq.${encodeURIComponent(orderId)},order_id.eq.${encodeURIComponent(orderId)})&select=*`, { headers });
  if (!orderRes.ok) return { ok: false, error: 'Order not found' };
  const rows = await orderRes.json();
  if (!rows || !rows.length) return { ok: false, error: 'Order not found' };
  const order = rows[0];

  const adminName = adminUser?.username ? `@${adminUser.username}` : (adminUser?.first_name || String(adminUser?.id || 'Admin'));

  const rejectedData = {
    ...(order.data || {}),
    status: 'rejected',
    orderStatus: 'rejected',
    paymentStatus: 'rejected',
    verified: false,
    approved: false,
    rejectedAt: Date.now(),
    rejectedBy: adminName
  };

  // Update order in Supabase
  await fetch(`${url}/rest/v1/orders?or=(id.eq.${encodeURIComponent(orderId)},order_id.eq.${encodeURIComponent(orderId)})`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      status: 'rejected',
      updated_at: new Date().toISOString(),
      data: rejectedData
    })
  });

  // Notify customer on Telegram
  const customerTgId = order.telegram_user_id || order.data?.telegramUserId;
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

  return { ok: true };
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
export async function broadcastNewProduct(rawProduct) {
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

  // 6. Recipients: Combine admins + all registered bot subscribers
  const botUsers = await getAllBotUsers();
  const adminIds = getAdminChatIds(); // ['8802192472', '6966868142']
  const recipientMap = new Map();

  // Always include admins so they receive every broadcast and verify it instantly
  for (const adminId of adminIds) {
    if (adminId && String(adminId).trim()) {
      recipientMap.set(String(adminId).trim(), { id: String(adminId).trim(), role: 'admin' });
    }
  }

  // Include all registered bot users
  for (const user of (botUsers || [])) {
    const uid = String(user?.id || user?.telegramUserId || '').trim();
    if (uid) {
      recipientMap.set(uid, { ...(user || {}), id: uid });
    }
  }

  const recipients = Array.from(recipientMap.values());
  if (recipients.length === 0) {
    return { ok: false, sentCount: 0, error: 'No Telegram recipients or admins found to broadcast to.' };
  }

  let sentCount = 0;
  let failCount = 0;
  const sampleErrors = [];

  for (const target of recipients) {
    const chatId = target.id;
    if (!chatId) continue;

    let delivered = false;

    // If an image URL is present, attempt sendPhoto first
    if (image && (image.startsWith('http://') || image.startsWith('https://'))) {
      try {
        const photoRes = await callTelegram('sendPhoto', {
          chat_id: chatId,
          photo: image,
          caption: messageText,
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        if (photoRes && photoRes.ok) {
          delivered = true;
        } else {
          console.warn(`sendPhoto failed for chat ${chatId} (${photoRes?.description || 'unknown'}), falling back to sendMessage...`);
        }
      } catch (photoErr) {
        console.warn(`sendPhoto exception for ${chatId}:`, photoErr.message);
      }
    }

    // Fallback to sendMessage if photo was not delivered or no image
    if (!delivered) {
      try {
        const msgRes = await callTelegram('sendMessage', {
          chat_id: chatId,
          text: messageText,
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        if (msgRes && msgRes.ok) {
          delivered = true;
        } else {
          console.warn(`sendMessage failed for chat ${chatId}:`, msgRes?.description || 'failed');
          if (sampleErrors.length < 5) {
            sampleErrors.push(`${chatId}: ${msgRes?.description || 'Delivery failed'}`);
          }
        }
      } catch (msgErr) {
        if (sampleErrors.length < 5) {
          sampleErrors.push(`${chatId}: ${msgErr.message}`);
        }
      }
    }

    if (delivered) {
      sentCount++;
    } else {
      failCount++;
    }

    // 50ms pause between sends to respect Telegram flood rate limits
    await new Promise(r => setTimeout(r, 50));
  }

  return { 
    ok: sentCount > 0, 
    sentCount, 
    failCount,
    totalRecipients: recipients.length,
    error: sentCount === 0 ? (sampleErrors[0] || 'Failed to dispatch to Telegram') : null
  };
}

/**
 * Generic Custom Announcement / Promotion Broadcast to all bot users
 */
export async function broadcastCustomMessage({ message, photo, buttonText, buttonUrl }) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    return { ok: false, error: 'Broadcast message content cannot be empty.' };
  }
  const cleanMsg = message.trim();
  const botUsers = await getAllBotUsers();
  const adminIds = getAdminChatIds();

  // Combine admins and bot users
  const recipientMap = new Map();
  for (const adminId of adminIds) {
    if (adminId && String(adminId).trim()) {
      recipientMap.set(String(adminId).trim(), { id: String(adminId).trim(), role: 'admin' });
    }
  }
  for (const user of (botUsers || [])) {
    const uid = String(user?.id || user?.telegramUserId || '').trim();
    if (uid) {
      recipientMap.set(uid, { ...(user || {}), id: uid });
    }
  }

  const recipients = Array.from(recipientMap.values());
  if (recipients.length === 0) {
    return { ok: false, error: 'No Telegram bot subscribers or admin recipients found yet.' };
  }

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
  const sampleErrors = [];

  for (const target of recipients) {
    const chatId = target.id;
    if (!chatId) continue;

    let delivered = false;

    if (cleanPhoto) {
      try {
        const photoRes = await callTelegram('sendPhoto', {
          chat_id: chatId,
          photo: cleanPhoto,
          caption: cleanMsg,
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {})
        });
        if (photoRes && photoRes.ok) {
          delivered = true;
        } else {
          console.warn(`sendPhoto failed for custom message to ${chatId}:`, photoRes?.description);
        }
      } catch (photoErr) {
        console.warn(`sendPhoto exception for ${chatId}:`, photoErr.message);
      }
    }

    if (!delivered) {
      try {
        const msgRes = await callTelegram('sendMessage', {
          chat_id: chatId,
          text: cleanMsg,
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {})
        });
        if (msgRes && msgRes.ok) {
          delivered = true;
        } else {
          console.warn(`sendMessage failed for custom message to ${chatId}:`, msgRes?.description);
          if (sampleErrors.length < 5) sampleErrors.push(`${chatId}: ${msgRes?.description || 'failed'}`);
        }
      } catch (msgErr) {
        if (sampleErrors.length < 5) sampleErrors.push(`${chatId}: ${msgErr.message}`);
      }
    }

    if (delivered) {
      sentCount++;
    } else {
      failCount++;
    }

    await new Promise(r => setTimeout(r, 50));
  }

  return {
    ok: sentCount > 0,
    sentCount,
    failCount,
    totalRecipients: recipients.length,
    error: sentCount === 0 ? (sampleErrors[0] || 'Broadcast failed to deliver') : null
  };
}

/**
 * Main Webhook Handler
 */
export default async function handler(req, res) {
  if (handleCors(req, res, 'GET, POST, OPTIONS')) return;

  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || '';

  // Setup / Re-register Webhook endpoint (Admin only)
  if ((action === 'setup-webhook' || action === 're-register-webhook') || (req.body && req.body.action === 're-register-webhook')) {
    if (!await verifyAdminRequest(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: Admin authentication required.' });
    }
    const appUrl = getAppUrl(req);
    const webhookUrl = `${appUrl}/api/telegram/bot`;
    const setRes = await callTelegram('setWebhook', {
      url: webhookUrl,
      drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query']
    });
    // Rebind Telegram mini app button
    await callTelegram('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: '🛍️ Open Store',
        web_app: { url: appUrl }
      }
    }).catch(() => {});
    const webhookInfo = await callTelegram('getWebhookInfo');
    const hookData = (webhookInfo && webhookInfo.ok && webhookInfo.result) 
      ? webhookInfo.result 
      : { url: webhookUrl, pending_update_count: 0 };

    return res.status(200).json({ 
      ok: setRes?.ok !== false, 
      webhookUrl, 
      result: setRes, 
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
      const expectedWebhook = `${appUrl}/api/telegram/bot`;
      let webhookInfo = await callTelegram('getWebhookInfo');

      // ⚡ Auto-Connect: If webhook URL is missing or empty, automatically connect it to this server!
      const currentHookUrl = webhookInfo?.result?.url || '';
      if (!currentHookUrl && cfg.token) {
        try {
          const autoRes = await callTelegram('setWebhook', {
            url: expectedWebhook,
            drop_pending_updates: false,
            allowed_updates: ['message', 'callback_query']
          });
          if (autoRes?.ok) {
            await callTelegram('setChatMenuButton', {
              menu_button: {
                type: 'web_app',
                text: '🛍️ Open Store',
                web_app: { url: appUrl }
              }
            });
            webhookInfo = await callTelegram('getWebhookInfo');
          }
        } catch (_) {}
      }

      const token = cfg.token || '';
      const maskedToken = token.length > 10 ? `${token.slice(0, 6)}...${token.slice(-4)}` : '***';
      const allUsers = await getAllBotUsers();
      const hookData = (webhookInfo && webhookInfo.ok && webhookInfo.result) 
        ? webhookInfo.result 
        : { url: expectedWebhook, pending_update_count: 0 };

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
        webhook: hookData,
        admins: getAdminChatIds(),
        usersCount: allUsers.length,
        appUrl
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
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
        await recordBotUser({
          id: uid,
          username: u.username || u.telegramUsername || '',
          first_name: u.first_name || u.firstName || u.name || '',
          last_name: u.last_name || u.lastName || ''
        }, u.source || 'mini_app_visit');

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
      const tgId = order.telegramUserId || (order.data && (order.data.telegramUserId || order.data.telegram_user_id));
      if (tgId) {
        recordBotUser({
          id: tgId,
          username: order.telegramUsername || (order.data && (order.data.telegramUsername || order.data.telegram)) || '',
          first_name: order.customerName || order.name || (order.data && (order.data.customerName || order.data.name)) || 'Telegram Buyer'
        }, 'order_checkout').catch(() => {});
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
      const product = req.body || {};
      const bcRes = await broadcastNewProduct(product);
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

      // 1. Handle Messages (e.g. /start or incoming chat)
      if (update.message) {
        const msg = update.message;
        const text = (msg.text || '').trim();
        const fromUser = msg.from;

        if (fromUser) {
          recordBotUser(fromUser).catch(() => {});
        }

        // ⚡ User entered bot / sent message -> Trigger 2-minute auto-delete on any unread VIP messages!
        if (msg.chat && msg.chat.id) {
          markUserMessagesAsRead(msg.chat.id);
        }

        if (text === '/start' || text.startsWith('/start')) {
          const payload = text.replace('/start', '').trim();
          const appUrl = getAppUrl(req);

          if (payload) {
            // User opened bot via deep link for a specific product e.g. /start prod_123
            const productViewUrl = `${appUrl}/index.html?productId=${encodeURIComponent(payload)}`;
            const checkoutUrl = `${appUrl}/payment.html?productId=${encodeURIComponent(payload)}`;
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
                  [{ text: '🛍️ Open VIP Store', web_app: { url: appUrl } }],
                  [{ text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }]
                ]
              }
            });
            return res.status(200).json({ ok: true });
          }

          const welcomeText = 
            `👋 <b>Welcome ${escapeTelegramHtml(fromUser.first_name || 'VIP Member')}!</b>\n\n` +
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
                [{ text: '🛍️ Open Store (VIP Content)', web_app: { url: appUrl } }],
                [{ text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }]
              ]
            }
          });
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
          recordBotUser(user, 'inline_interaction').catch(() => {});
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
            });
            return res.status(200).json({ ok: true });
          }

          // User just read/opened the link! Trigger 2-minute timer notice
          await callTelegram('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: '⏳ Link Unlocked! This message will automatically self-destruct in 2 minutes.',
            show_alert: true
          });

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
            });

            // Schedule deletion after exactly 120 seconds (2 minutes)
            markUserMessagesAsRead(cq.message.chat.id, orderId);
            scheduleMessageDeletion(cq.message.chat.id, cq.message.message_id, 120);
          }

          return res.status(200).json({ ok: true });
        }

        // ── B. Admin Only Clicks (Approve / Reject) ──
        if (!authorizedAdmins.includes(userIdStr)) {
          await callTelegram('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: '⚠️ You are not an authorized Admin for this bot!',
            show_alert: true
          });
          return res.status(200).json({ ok: true });
        }

        if (data.startsWith('appr_')) {
          const orderId = data.replace('appr_', '');
          await callTelegram('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: `✅ Order #${orderId} Approved!`
          });

          await processOrderApproval(orderId, adminUser);

          // Update Admin Message text
          const currentText = cq.message.caption || cq.message.text || '';
          const updatedText = currentText + `\n\n━━━━━━━━━━━━━━━━━━━━━━\n✅ <b>APPROVED by ${adminUser.first_name || 'Admin'} (@${adminUser.username || adminUser.id})</b>`;

          if (cq.message.photo) {
            await callTelegram('editMessageCaption', {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              caption: updatedText,
              parse_mode: 'HTML'
            });
          } else {
            await callTelegram('editMessageText', {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text: updatedText,
              parse_mode: 'HTML'
            });
          }

          return res.status(200).json({ ok: true });
        }

        if (data.startsWith('rejc_')) {
          const orderId = data.replace('rejc_', '');
          await callTelegram('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: `❌ Order #${orderId} Rejected!`
          });

          await processOrderRejection(orderId, adminUser);

          // Update Admin Message text
          const currentText = cq.message.caption || cq.message.text || '';
          const updatedText = currentText + `\n\n━━━━━━━━━━━━━━━━━━━━━━\n❌ <b>REJECTED by ${adminUser.first_name || 'Admin'} (@${adminUser.username || adminUser.id})</b>`;

          if (cq.message.photo) {
            await callTelegram('editMessageCaption', {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              caption: updatedText,
              parse_mode: 'HTML'
            });
          } else {
            await callTelegram('editMessageText', {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text: updatedText,
              parse_mode: 'HTML'
            });
          }

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

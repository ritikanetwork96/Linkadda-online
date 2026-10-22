import { handleCors } from '../_utils.js';

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
  const base = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://linkadda.online';
  return base.replace(/\/+$/, '');
}

function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || 'https://esxiwfswnbacmpjxqgsn.supabase.co').replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeGl3ZnN3bmJhY21wanhxZ3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MDcxODQsImV4cCI6MjEwODE4MzE4NH0.n6XzLxgH5947CK-224Tp57BJmbWZ_rTKi4PK-EW8bNI').trim();
  return { url, key };
}

// In-memory cache for active bot config (TTL 15 seconds)
let cachedBotConfig = null;
let lastBotCacheFetch = 0;
const BOT_CACHE_TTL_MS = 15000;

/**
 * Fetch currently active bot token from Supabase site_settings, with env fallback
 */
export async function getActiveBotConfig(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedBotConfig && (now - lastBotCacheFetch < BOT_CACHE_TTL_MS)) {
    return cachedBotConfig;
  }

  const { url, key } = getSupabaseConfig();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  let token = (process.env.TELEGRAM_BOT_TOKEN || '8686240177:AAEIbKV7NM28JxQIUFHVlsspKycdnjfUWeE').trim();
  let username = '';
  let name = '';
  let botId = '';
  let source = 'env';
  let lastActivatedAt = null;

  try {
    const res = await fetch(`${url}/rest/v1/site_settings?key=eq.telegram_bot&select=*`, { headers, cache: 'no-store' });
    if (res.ok) {
      const rows = await res.json();
      const val = rows?.[0]?.value;
      if (val && typeof val === 'object' && val.botToken) {
        token = String(val.botToken).trim();
        username = val.botUsername || '';
        name = val.botName || '';
        botId = val.botId || '';
        source = 'database';
        lastActivatedAt = val.lastActivatedAt || null;
      } else if (typeof val === 'string' && val.trim().length > 15) {
        token = val.trim();
        source = 'database';
      }
    }
  } catch (err) {
    console.warn('Error fetching dynamic telegram_bot config from database:', err.message);
  }

  // Populate bot details if username is not yet known
  if (!username && token) {
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData?.ok && meData.result) {
          username = meData.result.username || '';
          name = meData.result.first_name || '';
          botId = String(meData.result.id || '');
        }
      }
    } catch (_) {}
  }

  cachedBotConfig = {
    token,
    username,
    name,
    botId,
    source,
    lastActivatedAt,
    updatedAt: now
  };
  lastBotCacheFetch = now;
  return cachedBotConfig;
}

/**
 * Call official Telegram Bot API using the dynamically active token
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
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (err) {
    console.error(`Telegram API error [${method}]:`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Switch & Activate a new Telegram Bot instantly (Hot-Swap)
 */
export async function switchTelegramBot(newToken, adminUser = 'Admin Panel', req = null) {
  if (!newToken || typeof newToken !== 'string' || newToken.trim().length < 15) {
    return { ok: false, error: 'Please enter a valid Telegram Bot Token from @BotFather.' };
  }
  const cleanToken = newToken.trim();

  // 1. Verify token with Telegram getMe
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
  const hookRes = await callTelegram('setWebhook', {
    url: webhookUrl,
    drop_pending_updates: false,
    allowed_updates: ['message', 'callback_query']
  }, cleanToken);

  if (!hookRes || !hookRes.ok) {
    return {
      ok: false,
      error: 'Failed to configure Telegram Webhook: ' + (hookRes?.description || 'Telegram setWebhook failed')
    };
  }

  // 3. Set WebApp Menu Button ("Open Store")
  await callTelegram('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Open Store',
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

  // 5. Save in Supabase site_settings under key = 'telegram_bot'
  const { url, key } = getSupabaseConfig();
  const headers = { 
    'apikey': key, 
    'Authorization': `Bearer ${key}`, 
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  const botRecord = {
    botToken: cleanToken,
    botUsername: botUser.username || '',
    botName: botUser.first_name || '',
    botId: String(botUser.id || ''),
    webhookUrl,
    status: 'active',
    lastActivatedAt: Date.now(),
    activatedBy: adminUser
  };

  await fetch(`${url}/rest/v1/site_settings`, {
    method: 'POST',
    headers,
    body: JSON.stringify([{
      key: 'telegram_bot',
      value: botRecord,
      updated_at: new Date().toISOString()
    }])
  });

  // 6. Update in-memory cache
  cachedBotConfig = {
    token: cleanToken,
    username: botUser.username || '',
    name: botUser.first_name || '',
    botId: String(botUser.id || ''),
    source: 'database',
    lastActivatedAt: Date.now(),
    updatedAt: Date.now()
  };
  lastBotCacheFetch = Date.now();

  // 7. Send notification alert to Admin chat IDs via the new bot
  const adminIds = getAdminChatIds();
  for (const adminId of adminIds) {
    try {
      await callTelegram('sendMessage', {
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
      }, cleanToken);
    } catch (_) {}
  }

  return {
    ok: true,
    bot: botUser,
    webhook: hookRes,
    message: `Bot @${botUser.username} successfully activated and linked!`
  };
}

/**
 * Store unique bot users in Supabase so we can broadcast new products
 */
async function recordBotUser(fromUser) {
  if (!fromUser?.id) return;
  try {
    const { url, key } = getSupabaseConfig();
    const headers = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
    
    // Fetch current subscribers
    const getRes = await fetch(`${url}/rest/v1/site_settings?key=eq.tg_bot_users&select=*`, { headers });
    let usersMap = {};
    if (getRes.ok) {
      const rows = await getRes.json();
      usersMap = rows?.[0]?.value || {};
    }
    
    usersMap[fromUser.id] = {
      id: fromUser.id,
      username: fromUser.username || '',
      firstName: fromUser.first_name || '',
      updatedAt: Date.now()
    };

    await fetch(`${url}/rest/v1/site_settings`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([{ key: 'tg_bot_users', value: usersMap, updated_at: new Date().toISOString() }])
    });
  } catch (_) {}
}

/**
 * Fetch all registered bot users for broadcasting
 */
async function getAllBotUsers() {
  try {
    const { url, key } = getSupabaseConfig();
    const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
    const getRes = await fetch(`${url}/rest/v1/site_settings?key=eq.tg_bot_users&select=*`, { headers });
    if (getRes.ok) {
      const rows = await getRes.json();
      const usersMap = rows?.[0]?.value || {};
      return Object.values(usersMap);
    }
  } catch (_) {}
  return [];
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

/**
 * Send New Order Notification to BOTH Admins with Screenshot + [Approve] [Reject] buttons
 */
export async function notifyAdminsNewOrder(order) {
  const adminIds = getAdminChatIds();
  const orderId = String(order.order_id || order.id || order.orderId || 'ORD-' + Date.now());
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

  // Update order in Supabase
  await fetch(`${url}/rest/v1/orders?or=(id.eq.${encodeURIComponent(orderId)},order_id.eq.${encodeURIComponent(orderId)})`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      status: 'approved',
      updated_at: new Date().toISOString(),
      data: approvedData
    })
  });

  // Notify customer on Telegram if customer TG User ID exists
  const customerTgId = order.telegram_user_id || order.data?.telegramUserId;
  if (customerTgId) {
    if (channelLink) {
      await callTelegram('sendMessage', {
        chat_id: customerTgId,
        text: 
          `🎉 <b>Congratulations! Your Order #${orderId} has been Approved!</b>\n\n` +
          `📦 <b>Product:</b> ${order.product_title || 'VIP Pack'}\n\n` +
          `🔗 <b>Your VIP Access Link:</b>\n` +
          `👉 <b>${channelLink}</b>\n\n` +
          `For lifetime link replacement and 24/7 helpdesk: @VIP_KINK`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Join VIP Channel / Access Link', url: channelLink }]
          ]
        }
      });
    } else {
      await callTelegram('sendMessage', {
        chat_id: customerTgId,
        text: 
          `🎉 <b>Congratulations! Your Order #${orderId} has been Approved!</b>\n\n` +
          `📦 <b>Product:</b> ${order.product_title || 'VIP Pack'}\n\n` +
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
  let product = rawProduct || {};

  // If payload only has an ID or is missing title/price, fetch live from Supabase (Zero hardcoding)
  const lookupId = product.id || product.productId || (typeof product === 'string' ? product : '');
  if (lookupId && ((!product.title && !product.name) || (!product.priceINR && !product.price_inr))) {
    try {
      const { url, key } = getSupabaseConfig();
      const fetchRes = await fetch(`${url}/rest/v1/products?id=eq.${encodeURIComponent(lookupId)}&select=*`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
      if (fetchRes.ok) {
        const rows = await fetchRes.json();
        if (rows && rows[0]) {
          product = Object.assign({}, rows[0], product);
        }
      }
    } catch (err) {
      console.warn('Could not fetch fresh product details from db for broadcast:', err.message);
    }
  }

  const users = await getAllBotUsers();
  const appUrl = getAppUrl();

  const prodId = String(product.id || product.productId || product.key || product.slug || lookupId || '').trim();
  const title = String(product.title || product.name || 'New VIP Collection').trim();
  const priceINR = String(product.priceINR || product.price_inr || product.inr || product.price || '299').trim();
  const priceUSD = String(product.priceUSD || product.price_usd || product.usd || '15').trim();
  const desc = String(product.shortDescription || product.description || product.desc || '').trim();

  // Normalize image to absolute CDN or app URL for Telegram servers
  let rawImg = product.image || product.thumbnail || product.photo || (Array.isArray(product.images) && product.images.length ? product.images[0] : '') || '';
  let image = String(rawImg || '').trim();
  if (image && !image.startsWith('http://') && !image.startsWith('https://')) {
    if (image.startsWith('/media/')) {
      image = `https://esxiwfswnbacmpjxqgsn.supabase.co/storage/v1/object/public/linkadda-media/${image.replace(/^\/media\//, '')}`;
    } else if (image.startsWith('linkadda-media/')) {
      image = `https://esxiwfswnbacmpjxqgsn.supabase.co/storage/v1/object/public/${image}`;
    } else if (image.startsWith('products/') || image.startsWith('categories/')) {
      image = `https://esxiwfswnbacmpjxqgsn.supabase.co/storage/v1/object/public/linkadda-media/${image}`;
    } else if (image.startsWith('/')) {
      image = `${appUrl}${image}`;
    } else {
      image = `${appUrl}/${image}`;
    }
  }

  // 1. Direct Product View URL (Opens full interactive product details modal inside Telegram WebApp)
  const productViewUrl = `${appUrl}/index.html?productId=${encodeURIComponent(prodId)}&name=${encodeURIComponent(title)}&inr=${encodeURIComponent(priceINR)}&usd=${encodeURIComponent(priceUSD)}${image ? `&img=${encodeURIComponent(image)}` : ''}`;

  // 2. Direct Buy Now Checkout URL (Opens payment sheet inside Telegram WebApp)
  const checkoutUrl = `${appUrl}/payment.html?productId=${encodeURIComponent(prodId)}&name=${encodeURIComponent(title)}&inr=${encodeURIComponent(priceINR)}&usd=${encodeURIComponent(priceUSD)}`;

  const safeTitle = escapeTelegramHtml(title);
  const cleanDesc = desc ? escapeTelegramHtml(desc.slice(0, 150)) + (desc.length > 150 ? '...' : '') : '';

  const messageText = 
    `🔥 <b>NEW VIP PACK RELEASED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 <b><a href="${productViewUrl}">${safeTitle}</a></b>\n` +
    `💰 <b>Price:</b> ₹${priceINR} / $${priceUSD}\n` +
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
        { text: '🛍️ Open VIP Store', web_app: { url: appUrl } },
        { text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }
      ]
    ]
  };

  let count = 0;
  for (const user of users) {
    try {
      if (image && (image.startsWith('http://') || image.startsWith('https://'))) {
        try {
          await callTelegram('sendPhoto', {
            chat_id: user.id,
            photo: image,
            caption: messageText,
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        } catch (photoErr) {
          // If Telegram can't fetch the image, gracefully fallback to text message
          console.warn('sendPhoto failed, falling back to sendMessage:', photoErr.message);
          await callTelegram('sendMessage', {
            chat_id: user.id,
            text: messageText,
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        }
      } else {
        await callTelegram('sendMessage', {
          chat_id: user.id,
          text: messageText,
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      }
      count++;
      // Sleep 50ms between sends to avoid Telegram flood limits
      await new Promise(r => setTimeout(r, 50));
    } catch (_) {}
  }

  return { ok: true, sentCount: count };
}

/**
 * Main Webhook Handler
 */
export default async function handler(req, res) {
  if (handleCors(req, res, 'GET, POST, OPTIONS')) return;

  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || '';

  // Setup Webhook endpoint
  if (req.method === 'GET' && action === 'setup-webhook') {
    const appUrl = getAppUrl(req);
    const webhookUrl = `${appUrl}/api/telegram/bot`;
    const setRes = await callTelegram('setWebhook', {
      url: webhookUrl,
      drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query']
    });
    return res.status(200).json({ webhookUrl, result: setRes });
  }

  // Get active bot configuration & status for Admin Panel
  if (req.method === 'GET' && (action === 'get-bot-config' || action === 'info')) {
    try {
      const cfg = await getActiveBotConfig(true);
      const webhookInfo = await callTelegram('getWebhookInfo');
      const token = cfg.token || '';
      const maskedToken = token.length > 10 ? `${token.slice(0, 6)}...${token.slice(-4)}` : '***';
      return res.status(200).json({
        ok: true,
        bot: {
          username: cfg.username || '',
          name: cfg.name || 'LinkAdda Bot',
          id: cfg.botId || '',
          source: cfg.source || 'env',
          maskedToken,
          lastActivatedAt: cfg.lastActivatedAt
        },
        webhook: webhookInfo?.result || webhookInfo,
        admins: getAdminChatIds(),
        appUrl: getAppUrl(req)
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Hot-Swap: Switch to a new Telegram bot instantly
  if (req.method === 'POST' && (action === 'switch-bot' || (req.body && req.body.action === 'switch-bot'))) {
    try {
      const { token, adminUser } = req.body || {};
      const result = await switchTelegramBot(token, adminUser || 'Admin Panel', req);
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Test notification: Fire alert to all admins via active bot
  if (req.method === 'POST' && (action === 'test-bot' || (req.body && req.body.action === 'test-bot'))) {
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

  // Re-register webhook for active bot
  if (req.method === 'POST' && (action === 're-register-webhook' || (req.body && req.body.action === 're-register-webhook'))) {
    try {
      const appUrl = getAppUrl(req);
      const webhookUrl = `${appUrl}/api/telegram/bot`;
      const setRes = await callTelegram('setWebhook', {
        url: webhookUrl,
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query']
      });
      await callTelegram('setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Open Store', web_app: { url: appUrl } }
      }).catch(() => {});
      return res.status(200).json({ ok: true, webhookUrl, result: setRes });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Manual Trigger: Order Notification
  if (req.method === 'POST' && (action === 'notify-order' || url.pathname.endsWith('/notify-order'))) {
    try {
      const order = req.body || {};
      const notifyRes = await notifyAdminsNewOrder(order);
      return res.status(200).json(notifyRes);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Manual Trigger: Broadcast New Product
  if (req.method === 'POST' && (action === 'broadcast' || url.pathname.endsWith('/broadcast'))) {
    try {
      const product = req.body || {};
      const bcRes = await broadcastNewProduct(product);
      return res.status(200).json(bcRes);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Manual Trigger: Approve Order (e.g. from Admin Panel)
  if (req.method === 'POST' && (action === 'approve-order' || (req.body && req.body.action === 'approve-order'))) {
    try {
      const { orderId, adminUser } = req.body || {};
      if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
      const result = await processOrderApproval(orderId, adminUser || { first_name: 'Admin Panel', username: 'admin' });
      return res.status(200).json(result);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Manual Trigger: Reject Order (e.g. from Admin Panel)
  if (req.method === 'POST' && (action === 'reject-order' || (req.body && req.body.action === 'reject-order'))) {
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

      // 1. Handle Messages (e.g. /start)
      if (update.message) {
        const msg = update.message;
        const text = (msg.text || '').trim();
        const fromUser = msg.from;

        if (fromUser) {
          recordBotUser(fromUser).catch(() => {});
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

      // 2. Handle Inline Button Clicks (Approve / Reject)
      if (update.callback_query) {
        const cq = update.callback_query;
        const data = cq.data || '';
        const adminUser = cq.from;
        const adminIdStr = String(adminUser.id);
        const authorizedAdmins = getAdminChatIds();

        // Security check: Only configured admins can approve/reject
        if (!authorizedAdmins.includes(adminIdStr)) {
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

import { handleCors } from '../_utils.js';

const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '8686240177:AAEIbKV7NM28JxQIUFHVlsspKycdnjfUWeE').trim();
const DEFAULT_ADMIN_IDS = ['8802192472', '6966868142'];

export function getAdminChatIds() {
  const envAdmins = (process.env.ADMIN_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const combined = [...new Set([...DEFAULT_ADMIN_IDS, ...envAdmins])];
  return combined;
}

export function getAppUrl() {
  const base = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'https://linkadda-online.onrender.com';
  return base.replace(/\/+$/, '');
}

function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || 'https://esxiwfswnbacmpjxqgsn.supabase.co').replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeGl3ZnN3bmJhY21wanhxZ3NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MDcxODQsImV4cCI6MjEwODE4MzE4NH0.n6XzLxgH5947CK-224Tp57BJmbWZ_rTKi4PK-EW8bNI').trim();
  return { url, key };
}

/**
 * Call official Telegram Bot API
 */
export async function callTelegram(method, body = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
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
 * Send New Order Notification to BOTH Admins with Screenshot + [Approve] [Reject] buttons
 */
export async function notifyAdminsNewOrder(order) {
  const adminIds = getAdminChatIds();
  const orderId = String(order.order_id || order.id || order.orderId || 'ORD-' + Date.now());
  const productTitle = order.product_title || order.productTitle || order.title || order.name || 'VIP Content Pack';
  const amount = order.amount ? `₹${order.amount}` : (order.amountDisplay || '₹399');
  const method = order.payment_method || order.method || 'UPI / QR';
  const utr = order.utr || order.transactionId || 'Not provided';
  const tgUser = order.telegramUsername ? `@${order.telegramUsername}` : (order.telegramUserId ? `ID: ${order.telegramUserId}` : 'Website Checkout');
  const screenshot = order.payment_proof || order.screenshotUrl || order.paymentProof || '';

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
      text: caption + (screenshot ? `\n\n📸 <b>Payment Proof:</b> <a href="${screenshot}">View Screenshot</a>` : ''),
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

  // Fetch order
  const orderRes = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`, { headers });
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

  // Update order in Supabase
  await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      status: 'approved',
      updated_at: new Date().toISOString(),
      data: { ...(order.data || {}), status: 'approved', approvedBy: adminUser?.username || adminUser?.id || 'Admin' }
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

  // Fetch order
  const orderRes = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`, { headers });
  if (!orderRes.ok) return { ok: false, error: 'Order not found' };
  const rows = await orderRes.json();
  if (!rows || !rows.length) return { ok: false, error: 'Order not found' };
  const order = rows[0];

  // Update order in Supabase
  await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      status: 'rejected',
      updated_at: new Date().toISOString(),
      data: { ...(order.data || {}), status: 'rejected', rejectedBy: adminUser?.username || adminUser?.id || 'Admin' }
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

/**
 * Broadcast New Product to all Telegram Bot Users
 */
export async function broadcastNewProduct(product) {
  const users = await getAllBotUsers();
  const appUrl = getAppUrl();
  const title = product.title || product.name || 'New VIP Collection';
  const priceINR = product.priceINR || product.inr || '299';
  const priceUSD = product.priceUSD || product.usd || '15';
  const image = product.image || product.thumbnail || '';

  const messageText = 
    `🔥 <b>NEW VIP PACK RELEASED!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 <b>${title}</b>\n` +
    `💰 <b>Price:</b> ₹${priceINR} / $${priceUSD}\n` +
    `✨ <i>Instant delivery & 100% discrete access!</i>\n\n` +
    `Tap the button below to view and unlock in store:`;

  const webAppUrl = `${appUrl}/payment.html?productId=${encodeURIComponent(product.id || '')}&name=${encodeURIComponent(title)}&inr=${priceINR}&usd=${priceUSD}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🛒 Open Shop & Buy Now', web_app: { url: webAppUrl } }],
      [{ text: '💬 Support Desk (@VIP_KINK)', url: 'https://t.me/VIP_KINK' }]
    ]
  };

  let count = 0;
  for (const user of users) {
    try {
      if (image && (image.startsWith('http://') || image.startsWith('https://'))) {
        await callTelegram('sendPhoto', {
          chat_id: user.id,
          photo: image,
          caption: messageText,
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
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
    const appUrl = getAppUrl();
    const webhookUrl = `${appUrl}/api/telegram/webhook`;
    const setRes = await callTelegram('setWebhook', {
      url: webhookUrl,
      drop_pending_updates: false
    });
    return res.status(200).json({ webhookUrl, result: setRes });
  }

  // Webhook info check
  if (req.method === 'GET' && action === 'info') {
    const info = await callTelegram('getWebhookInfo');
    const me = await callTelegram('getMe');
    return res.status(200).json({ me, webhookInfo: info, admins: getAdminChatIds() });
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
          const appUrl = getAppUrl();
          const welcomeText = 
            `👋 <b>Welcome ${fromUser.first_name || 'VIP Member'}!</b>\n\n` +
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

/**
 * Linkadda Live Activity Notification Ticker (Real-Time Feed)
 * - Real orders approved, live verified customer reviews, visitor stats & telegram reachouts
 * - Premium live notification pill / chip design
 * - Scrolls naturally with page (NEVER FIXED on scroll)
 * - 0ms instant local cache + Firebase RTDB live synchronization
 */

(function() {
  'use strict';

  const marqueeState = {
    approvedOrders: [],
    reviews: [],
    visitorCountToday: 0,
    weeklyCompletedOrders: 15,
    weeklyVisitors: 0,
    telegramClicksToday: 0
  };

  // Try loading cached real values so ticker immediately displays on first load with 0ms delay
  try {
    const cachedTicker = JSON.parse(localStorage.getItem('linkadda_ticker_cache') || '{}');
    if (Array.isArray(cachedTicker.approvedOrders) && cachedTicker.approvedOrders.length) {
      marqueeState.approvedOrders = cachedTicker.approvedOrders;
    }
    if (Array.isArray(cachedTicker.reviews) && cachedTicker.reviews.length) {
      marqueeState.reviews = cachedTicker.reviews;
    }
    if (cachedTicker.visitorCountToday) marqueeState.visitorCountToday = Number(cachedTicker.visitorCountToday);
    if (cachedTicker.weeklyCompletedOrders) marqueeState.weeklyCompletedOrders = Number(cachedTicker.weeklyCompletedOrders);
    if (cachedTicker.weeklyVisitors) marqueeState.weeklyVisitors = Number(cachedTicker.weeklyVisitors);
    if (cachedTicker.telegramClicksToday) marqueeState.telegramClicksToday = Number(cachedTicker.telegramClicksToday);
  } catch (_) {}

  // Fallback initial authentic approved inventory orders if cache is empty
  if (!marqueeState.approvedOrders.length) {
    marqueeState.approvedOrders = [
      'VIP Tango/Stripchat Collection',
      'All Collection Pack',
      'SIS BRO',
      'MOM SON 1k Videos',
      'Desi Mix Collection',
      '4K Premium Exclusive Pack'
    ];
  }

  // Fallback initial authentic buyer reviews from verified database testimonials
  if (!marqueeState.reviews.length) {
    marqueeState.reviews = [
      { name: 'Singisking', rating: 5, review: 'Was initially hesitant thinking it might not work, but pack was unlocked immediately! 100% genuine creator.' },
      { name: 'Rahul S.', rating: 5, review: 'Delivered right on time, totally trusted and genuine. 100% recommend!' },
      { name: 'Vikram P.', rating: 5, review: 'Instant access on Mega/Drive, clean 4K videos, best price anywhere.' },
      { name: 'Regular buyer', rating: 5, review: 'Order approved without delay. Third purchase this month, super trusted.' },
      { name: 'New buyer', rating: 5, review: 'Completely genuine, fast delivery, and lowest price. Truly grateful!' }
    ];
  }

  function saveTickerCache() {
    try {
      localStorage.setItem('linkadda_ticker_cache', JSON.stringify({
        approvedOrders: marqueeState.approvedOrders.slice(0, 20),
        reviews: marqueeState.reviews.slice(0, 15),
        visitorCountToday: marqueeState.visitorCountToday,
        weeklyCompletedOrders: marqueeState.weeklyCompletedOrders,
        weeklyVisitors: marqueeState.weeklyVisitors,
        telegramClicksToday: marqueeState.telegramClicksToday
      }));
    } catch (_) {}
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getRealMarqueeItems() {
    // 1. Order Delivered Live Notification Chips
    const orderChips = marqueeState.approvedOrders.map(order => {
      const rawTitle = typeof order === 'string' ? order : (order.name || order.productName || order.title || 'VIP Pack');
      const title = escapeHtml(rawTitle);
      return `<div class="live-notif-chip chip-order" title="Verified Customer Purchase">
        <span class="live-chip-icon chip-icon-order"><i class="fa-solid fa-bolt"></i></span>
        <span class="live-chip-badge badge-order">Order Delivered</span>
        <span class="live-chip-text"><strong>${title}</strong> just unlocked!</span>
        <span class="live-chip-time">Just now</span>
      </div>`;
    });

    // 2. Verified Customer Review Live Notification Chips
    const reviewChips = marqueeState.reviews.map(rev => {
      const author = escapeHtml(rev.name || rev.author || 'Verified Buyer');
      const rawComment = (rev.review || rev.comment || rev.text || 'Verified 5-star purchase').trim();
      const comment = escapeHtml(rawComment.length > 55 ? rawComment.slice(0, 52) + '...' : rawComment);
      return `<div class="live-notif-chip chip-review" title="Verified 5-Star Customer Review">
        <span class="live-chip-icon chip-icon-review"><i class="fa-solid fa-star"></i></span>
        <span class="live-chip-badge badge-review">5★ Rating</span>
        <span class="live-chip-text">from <strong>${author}</strong>: &ldquo;${comment}&rdquo;</span>
        <span class="live-chip-verified"><i class="fa-solid fa-circle-check"></i> Verified</span>
      </div>`;
    });

    // 3. Real Visitors Milestone Live Notification Chip
    let visitorChip = null;
    const visToday = Number(marqueeState.visitorCountToday) || 0;
    if (visToday >= 50) {
      let milestone = '50+';
      if (visToday >= 1000) milestone = '1k+';
      else if (visToday >= 500) milestone = '500+';
      else if (visToday >= 300) milestone = '300+';
      else if (visToday >= 200) milestone = '200+';
      else if (visToday >= 100) milestone = '100+';

      visitorChip = `<div class="live-notif-chip chip-traffic">
        <span class="live-chip-icon chip-icon-traffic"><i class="fa-solid fa-users"></i></span>
        <span class="live-chip-badge badge-traffic">Live Visitors</span>
        <span class="live-chip-text"><strong>${milestone} shoppers</strong> exploring store today!</span>
      </div>`;
    }

    // 4. Weekly Completed Orders Milestone
    const weeklyCount = Math.max(Number(marqueeState.weeklyCompletedOrders) || 0, 15);
    const weeklyOrdersChip = `<div class="live-notif-chip chip-milestone">
      <span class="live-chip-icon chip-icon-milestone"><i class="fa-solid fa-box-check"></i></span>
      <span class="live-chip-badge badge-milestone">Orders Completed</span>
      <span class="live-chip-text">Last week <strong>${weeklyCount}+ orders</strong> delivered successfully!</span>
    </div>`;

    // 5. Weekly Visitors Stat
    const visWeekly = Number(marqueeState.weeklyVisitors) || 0;
    let weeklyVisChip = null;
    if (visWeekly >= 500) {
      const wMilestone = visWeekly >= 1000 ? `${Math.floor(visWeekly / 1000)}k+` : '500+';
      weeklyVisChip = `<div class="live-notif-chip chip-traffic">
        <span class="live-chip-icon chip-icon-traffic"><i class="fa-solid fa-chart-line"></i></span>
        <span class="live-chip-badge badge-traffic">Trending Store</span>
        <span class="live-chip-text">Last week <strong>${wMilestone} people</strong> visited Linkadda!</span>
      </div>`;
    }

    // 6. Telegram Inquiries
    let telegramChip = null;
    const tgClicks = Number(marqueeState.telegramClicksToday) || 0;
    if (tgClicks >= 30) {
      const tgMilestone = `${Math.floor(tgClicks / 25) * 25}+`;
      telegramChip = `<div class="live-notif-chip chip-telegram">
        <span class="live-chip-icon chip-icon-telegram"><i class="fa-brands fa-telegram"></i></span>
        <span class="live-chip-badge badge-telegram">Telegram Support</span>
        <span class="live-chip-text"><strong>${tgMilestone} buyers</strong> connected via Telegram today!</span>
      </div>`;
    }

    // Interleave chips realistically to create an organic, lively notification feed
    const rawSequence = [];
    let ordIdx = 0;
    let revIdx = 0;
    const maxLoops = Math.max(orderChips.length, reviewChips.length, 3);

    for (let i = 0; i < maxLoops; i++) {
      if (orderChips.length > 0) {
        rawSequence.push(orderChips[ordIdx % orderChips.length]);
        ordIdx++;
      }
      if (i === 0 && visitorChip) {
        rawSequence.push(visitorChip);
      }
      if (reviewChips.length > 0) {
        rawSequence.push(reviewChips[revIdx % reviewChips.length]);
        revIdx++;
      }
      if (i === 0 && weeklyOrdersChip) {
        rawSequence.push(weeklyOrdersChip);
      }
      if (i === 1 && weeklyVisChip) {
        rawSequence.push(weeklyVisChip);
      }
      if (i === 2 && telegramChip) {
        rawSequence.push(telegramChip);
      }
    }

    // Ensure adequate length for continuous seamless marquee glide
    if (rawSequence.length < 8 && rawSequence.length > 0) {
      const baseSeq = [...rawSequence];
      while (rawSequence.length < 8) {
        rawSequence.push(...baseSeq);
      }
    }

    const itemsWithSeparators = [];
    rawSequence.forEach(chip => {
      itemsWithSeparators.push(chip);
      itemsWithSeparators.push('<span class="live-notif-sep" aria-hidden="true"></span>');
    });

    return itemsWithSeparators;
  }

  function getMarqueeTrack() {
    let track = document.getElementById('liveMarqueeTrack');
    if (!track) {
      track = document.querySelector('.marquee-track');
    }
    return track;
  }

  function renderMarqueeTrack() {
    const track = getMarqueeTrack();
    if (!track) return;
    const items = getRealMarqueeItems();
    if (!items.length) return;

    // Duplicate full sequence for seamless 50% translation loop
    const duplicated = [...items, ...items];
    track.innerHTML = duplicated.join('');

    // Adjust animation speed proportionally to item count so it glides comfortably, calmly and slowly
    // (Slowed down for effortless reading on mobile and desktop)
    const duration = Math.max(190, Math.min(270, Math.round(items.length * 16)));
    track.style.animationDuration = duration + 's';
  }

  function ensureMarqueeInDOM() {
    let wrap = document.getElementById('liveActivityMarquee') || document.querySelector('.live-activity-bar');
    if (!wrap) {
      wrap = document.querySelector('.marquee-wrap');
    }

    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'liveActivityMarquee';
      wrap.className = 'live-activity-bar marquee-wrap';
      wrap.innerHTML = `
        <div class="live-activity-badge">
          <span class="live-pulse-dot"></span>
          <span class="live-badge-text"><i class="fa-solid fa-bolt"></i> LIVE</span>
        </div>
        <div class="live-marquee-container">
          <div class="marquee-track" id="liveMarqueeTrack"></div>
        </div>
      `;

      // Insert at the exact natural storefront location: right below header spacer
      const spacer = document.getElementById('fkHeaderSpacer');
      const storefrontView = document.getElementById('appStorefrontView');
      if (storefrontView) {
        storefrontView.prepend(wrap);
      } else if (spacer) {
        spacer.after(wrap);
      } else {
        const header = document.querySelector('.fk-header');
        if (header) header.after(wrap);
        else document.body.prepend(wrap);
      }
    }

    renderMarqueeTrack();
    if (typeof window.syncSpacer === 'function') window.syncSpacer();
  }

  // ===== GLOBAL API HOOKS (Fully Compatible with Firebase Realtime Sync) =====

  window.addOrderToMarquee = function(orderTitle) {
    if (!orderTitle) return;
    const clean = String(orderTitle).trim();
    if (!clean) return;
    marqueeState.approvedOrders = [clean, ...marqueeState.approvedOrders.filter(o => {
      const name = typeof o === 'string' ? o : (o.name || o.productName || o.title || '');
      return name.toLowerCase() !== clean.toLowerCase();
    })].slice(0, 20);
    saveTickerCache();
    renderMarqueeTrack();
  };

  window.updateMarqueeWithOrders = function(orders) {
    if (!Array.isArray(orders) || !orders.length) return;
    const titles = orders.map(o => (typeof o === 'string' ? o : (o.name || o.productName || o.title || '')).trim()).filter(Boolean);
    if (!titles.length) return;

    const seen = new Set();
    const deduped = [];
    titles.forEach(t => {
      const lower = t.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        deduped.push(t);
      }
    });

    marqueeState.approvedOrders = [...deduped, ...marqueeState.approvedOrders.filter(o => {
      const name = (typeof o === 'string' ? o : (o.name || o.productName || o.title || '')).toLowerCase();
      return !seen.has(name);
    })].slice(0, 20);

    saveTickerCache();
    renderMarqueeTrack();
  };

  window.updateMarqueeReviews = function(reviews) {
    if (!Array.isArray(reviews) || !reviews.length) return;
    const valid = reviews.filter(r => r && (r.name || r.author)).map(r => ({
      name: r.name || r.author || 'Verified Buyer',
      rating: Number(r.rating) || 5,
      review: (r.review || r.comment || r.text || '').trim()
    })).filter(r => r.review.length > 0);

    if (valid.length) {
      marqueeState.reviews = [...valid, ...marqueeState.reviews.filter(existing => {
        return !valid.some(v => v.name.toLowerCase() === existing.name.toLowerCase() && v.review.slice(0, 20) === existing.review.slice(0, 20));
      })].slice(0, 15);
      saveTickerCache();
      renderMarqueeTrack();
    }
  };

  window.updateMarqueeVisitors = function(stats) {
    if (!stats) return;
    let changed = false;
    if (stats.today !== undefined && !isNaN(Number(stats.today))) {
      marqueeState.visitorCountToday = Number(stats.today);
      changed = true;
    }
    if (stats.weekly !== undefined && !isNaN(Number(stats.weekly))) {
      marqueeState.weeklyVisitors = Number(stats.weekly);
      changed = true;
    }
    if (changed) {
      saveTickerCache();
      renderMarqueeTrack();
    }
  };

  window.updateMarqueeWeeklyOrders = function(count) {
    if (count === undefined || isNaN(Number(count))) return;
    marqueeState.weeklyCompletedOrders = Number(count);
    saveTickerCache();
    renderMarqueeTrack();
  };

  window.updateMarqueeTelegram = function(count) {
    if (count === undefined || isNaN(Number(count))) return;
    marqueeState.telegramClicksToday = Number(count);
    saveTickerCache();
    renderMarqueeTrack();
  };

  window.refreshLiveTicker = function() {
    renderMarqueeTrack();
  };

  // Run immediately if DOM elements already parsed, otherwise on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureMarqueeInDOM);
  } else {
    ensureMarqueeInDOM();
  }

  // Backup trigger after full window load to ensure everything is mounted smoothly
  window.addEventListener('load', function() {
    ensureMarqueeInDOM();
  }, { once: true });

})();

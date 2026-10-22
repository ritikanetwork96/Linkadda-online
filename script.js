// --- LinkAdda Site Integrity Guard ---
(function(){try{var h=(window.location.hostname||'').toLowerCase(),p=window.location.protocol;var isAllowed=h==='localhost'||h==='127.0.0.1'||h===''||p==='file:'||h==='linkadda.online'||h==='www.linkadda.online'||h.endsWith('.pages.dev')||h.endsWith('.vercel.app')||h.endsWith('.netlify.app')||h.endsWith('.onrender.com');if(!isAllowed){/* Domain guard relaxed during migration */}}catch(_){}})();
// ===== LOADING SCREEN =====
(function() {
  const wrap    = document.getElementById('loaderWrap');
  const bar     = document.getElementById('loaderBar');
  const pct     = document.getElementById('loaderPct');
  const lParts  = document.getElementById('loaderParticles');
  const colors  = ['#e84393','#7c3aed','#f472b6','#a855f7','#f59e0b'];
  if (!wrap || !bar || !pct) return;

  document.body.classList.add('loading');

  // Spawn loader particles
  function spawnLP() {
    if (!lParts || wrap.classList.contains('hide')) return;
    const p = document.createElement('div');
    p.className = 'lp';
    const size = Math.random() * 4 + 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText = `
      width:${size}px;height:${size}px;
      background:${color};
      left:${Math.random()*100}%;
      bottom:-10px;
      animation-duration:${Math.random()*8+5}s;
      animation-delay:${Math.random()*2}s;
      box-shadow:0 0 ${size*2}px ${color};
    `;
    lParts.appendChild(p);
    setTimeout(() => p.remove(), 6000);
  }
  const lpInterval = setInterval(spawnLP, 350);
  for (let i = 0; i < 8; i++) spawnLP();

  // Progress animation
  let progress = 0;
  const messages = [
    'Loading premium content...',
    'Preparing 4K videos...',
    'Almost ready...',
    'Welcome!'
  ];
  const subEl = wrap.querySelector('.loader-sub');

  const finishLoader = () => {
    if (wrap.classList.contains('hide')) return;
    progress = 100;
    bar.style.width = '100%';
    pct.textContent = '100%';
    clearInterval(timer);
    clearInterval(lpInterval);
    wrap.classList.add('hide');
    document.body.classList.remove('loading');
    setTimeout(() => { try { wrap.remove(); } catch (_) {} }, 200);
  };

  const timer = setInterval(() => {
    progress = Math.min(progress + 25, 100);
    bar.style.width = progress + '%';
    pct.textContent = Math.floor(progress) + '%';
    if (progress >= 100) {
      finishLoader();
    }
  }, 16);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    finishLoader();
  } else {
    document.addEventListener('DOMContentLoaded', finishLoader, { once: true });
    window.addEventListener('load', finishLoader, { once: true });
    setTimeout(finishLoader, 350); // Hard ceiling guarantees instant appearance
  }
})();

const finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
const finePointer = () => finePointerQuery.matches;
const pointerEffectsEnabled = () => finePointer();

function rafThrottle(fn) {
  let frame = 0;
  let lastArgs = null;
  return function(...args) {
    lastArgs = args;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fn.apply(this, lastArgs || []);
    });
  };
}

// ===== HEADER SCROLL =====
// ===== HEADER SCROLL (Zero layout-thrashing cached calculation) =====
const header = document.getElementById('header');
const progressBar = document.createElement('div');
progressBar.className = 'scroll-progress';
document.body.prepend(progressBar);

let cachedMaxScroll = 1;
const recalculateMaxScroll = () => {
  cachedMaxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
};
recalculateMaxScroll();
window.addEventListener('resize', recalculateMaxScroll, { passive: true });
window.addEventListener('load', recalculateMaxScroll, { passive: true, once: true });
window.addEventListener('linkadda:catalog-updated', recalculateMaxScroll, { passive: true });

let isHeaderScrolled = false;
const updateScrollState = () => {
  const scrollY = window.scrollY || window.pageYOffset || 0;
  const shouldBeScrolled = scrollY > 40;
  if (header && isHeaderScrolled !== shouldBeScrolled) {
    isHeaderScrolled = shouldBeScrolled;
    header.classList.toggle('scrolled', shouldBeScrolled);
  }
  const pct = Math.max(0, Math.min(100, (scrollY / cachedMaxScroll) * 100));
  progressBar.style.width = pct + '%';
};
const requestScrollStateUpdate = rafThrottle(updateScrollState);
window.addEventListener('scroll', requestScrollStateUpdate, { passive: true });
window.addEventListener('resize', requestScrollStateUpdate, { passive: true });
updateScrollState();

// ===== AURORA BACKGROUND (Desktop Only for Maximum Mobile Scroll Performance) =====
if (window.innerWidth > 768 && pointerEffectsEnabled()) {
  const aurora = document.createElement('div');
  aurora.className = 'aurora';
  aurora.innerHTML = '<div class="aurora-blob"></div><div class="aurora-blob"></div><div class="aurora-blob"></div>';
  document.body.prepend(aurora);
}

// ===== CURSOR GLOW =====
if (pointerEffectsEnabled()) {
  const cursorGlow = document.createElement('div');
  cursorGlow.className = 'cursor-glow';
  document.body.appendChild(cursorGlow);
  const updateCursorGlow = rafThrottle((e) => {
    cursorGlow.style.left = e.clientX + 'px';
    cursorGlow.style.top  = e.clientY + 'px';
  });
  document.addEventListener('pointermove', updateCursorGlow, { passive: true });
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) cursorGlow.style.opacity = '0';
  });
  document.addEventListener('pointerover', () => { cursorGlow.style.opacity = '1'; });
}

// Floating telegram badge removed as requested (Support icon in bottom appbar is active)

// ===== SECTION DIVIDERS =====
document.querySelectorAll('section').forEach(sec => {
  const div = document.createElement('div');
  div.className = 'section-divider';
  sec.after(div);
});

// ===== MOBILE MENU =====
const menuToggle = document.getElementById('menuToggle');
const mobileNav  = document.getElementById('mobileNav');
if (menuToggle && mobileNav) {
  menuToggle.addEventListener('click', () => {
    mobileNav.classList.toggle('open');
    const icon = menuToggle.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-bars');
      icon.classList.toggle('fa-xmark');
    }
  });
  mobileNav.querySelectorAll('.mob-link').forEach(link => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      const icon = menuToggle.querySelector('i');
      if (icon) {
        icon.classList.add('fa-bars');
        icon.classList.remove('fa-xmark');
      }
    });
  });
}

// ===== PARTICLES =====
const particlesContainer = document.getElementById('particles');
const colors = ['#e84393', '#7c3aed', '#f472b6', '#a855f7'];

function createParticle() {
  if (!particlesContainer) return;
  const p = document.createElement('div');
  p.className = 'particle';
  const size = Math.random() * 5 + 2;
  const color = colors[Math.floor(Math.random() * colors.length)];
  const left = Math.random() * 100;
  const duration = Math.random() * 12 + 8;
  const delay = Math.random() * 5;
  p.style.cssText = `
    width:${size}px;height:${size}px;
    background:${color};left:${left}%;bottom:-10px;
    animation-duration:${duration}s;animation-delay:${delay}s;
    opacity:0;box-shadow:0 0 ${size*2}px ${color};
  `;
  particlesContainer.appendChild(p);
  setTimeout(() => p.remove(), (duration + delay) * 1000);
}
if (particlesContainer) {
  const particleInterval = finePointer() ? 1200 : 2000;
  setInterval(createParticle, particleInterval);
  const particleBurstCount = finePointer() ? 10 : 5;
  for (let i = 0; i < particleBurstCount; i++) createParticle();
}

// ===== GLITCH EFFECT ON HERO TITLE =====
const gradientTexts = document.querySelectorAll('.gradient-text');
gradientTexts.forEach(el => {
  el.classList.add('glitch');
  el.setAttribute('data-text', el.textContent);
});

// ===== TYPEWRITER on hero-sub =====
const heroSub = document.querySelector('.hero-sub');
if (heroSub) {
  const originalText = heroSub.textContent.trim();
  heroSub.textContent = '';
  const cursor = document.createElement('span');
  cursor.className = 'typewriter-cursor';
  heroSub.appendChild(cursor);
  let i = 0;
  const typeSpeed = 28;
  function typeChar() {
    if (i < originalText.length) {
      if (cursor.parentNode === heroSub) {
        heroSub.insertBefore(document.createTextNode(originalText[i]), cursor);
        i++;
        setTimeout(typeChar, typeSpeed);
      }
    }
  }
  setTimeout(typeChar, 900);
}

// ===== CARD SHINE ELEMENT =====
document.querySelectorAll('.cat-card, .pcard').forEach(card => {
  const shine = document.createElement('div');
  shine.className = 'shine';
  card.appendChild(shine);
});

// ===== LAST SOLD BADGE =====
function hashSeed(text) {
  let hash = 0;
  const value = String(text || 'card');
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function formatLastSold(minutes) {
  if (minutes < 60) return `Last sold ${minutes} min ago`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return `Last sold ${hours} hr ago`;
}

function updateLastSoldBadges() {
  const cards = document.querySelectorAll('.pcard');
  const baseTick = Math.floor(Date.now() / 60000);
  const options = [4, 7, 9, 12, 16, 18, 21, 24, 28, 33, 39, 44, 52, 58, 63, 74, 88, 96, 112];

  cards.forEach((card, index) => {
    const title = card.querySelector('.pcard-title')?.textContent?.trim() || `card-${index}`;
    const seed = hashSeed(title);
    const minutes = options[(baseTick + seed) % options.length];
    let badge = card.querySelector('.last-sold-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'last-sold-badge';
      badge.innerHTML = '<i class="fa-solid fa-circle"></i><span></span>';
      card.appendChild(badge);
    }
    badge.querySelector('span').textContent = formatLastSold(minutes);
  });
}

updateLastSoldBadges();
setInterval(updateLastSoldBadges, 60000);

// ===== 3D TILT on why-cards =====
if (pointerEffectsEnabled()) {
  document.querySelectorAll('.why-card, .testi-card, .contact-card').forEach(card => {
    const updateTilt = rafThrottle((e) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width  - 0.5) * 14;
      const y = ((e.clientY - rect.top)  / rect.height - 0.5) * 14;
      card.style.transform = `translateY(-6px) rotateX(${-y}deg) rotateY(${x}deg)`;
    });
    card.addEventListener('pointermove', updateTilt, { passive: true });
    card.addEventListener('pointerleave', () => {
      card.style.transform = '';
    });
  });
}

// ===== 3D TILT on cat-cards =====
if (pointerEffectsEnabled()) {
  document.querySelectorAll('.cat-card, .pcard').forEach(card => {
    const updateTilt = rafThrottle((e) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width  - 0.5) * 10;
      const y = ((e.clientY - rect.top)  / rect.height - 0.5) * 10;
      card.style.transform = `translateY(-8px) rotateX(${-y}deg) rotateY(${x}deg)`;
    });
    card.addEventListener('pointermove', updateTilt, { passive: true });
    card.addEventListener('pointerleave', () => {
      card.style.transform = '';
    });
  });
}

// ===== COUNTER ANIMATION on hero stats =====
function animateCount(el, target, suffix = '') {
  let current = 0;
  const step = Math.ceil(target / 60);
  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = current + suffix;
    if (current >= target) clearInterval(timer);
  }, 25);
}
const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const nums = entry.target.querySelectorAll('.stat-num');
      nums.forEach(num => {
        const text = num.textContent.trim();
        if (text === '500+')  animateCount(num, 500, '+');
        if (text === '24/7')  { /* leave as is */ }
        if (text === '100%')  animateCount(num, 100, '%');
      });
      statsObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });
const statsEl = document.querySelector('.hero-stats');
if (statsEl) statsObserver.observe(statsEl);

// ===== SCROLL REVEAL =====
const revealEls = document.querySelectorAll(
  '.why-card, .cat-card, .pcard, .testi-card, .contact-card, .section-head, .hero-stats, .pb-content, .pricing-banner-card'
);
revealEls.forEach(el => el.classList.add('reveal'));
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.05, rootMargin: '0px 0px 80px 0px' });
revealEls.forEach(el => observer.observe(el));

// ===== SMOOTH ACTIVE NAV =====
const sections  = document.querySelectorAll('section[id]');
const navLinks  = document.querySelectorAll('.nav-link');
const setActiveNav = (id) => {
  navLinks.forEach(link => {
    const isActive = link.getAttribute('href') === `#${id}`;
    link.style.color = isActive ? 'var(--primary)' : '';
  });
};
if ('IntersectionObserver' in window && sections.length) {
  const navObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length) {
      setActiveNav(visible[0].target.getAttribute('id'));
    }
  }, {
    rootMargin: '-40% 0px -50% 0px',
    threshold: 0.1,
  });
  sections.forEach(sec => navObserver.observe(sec));
  const firstSection = document.querySelector('section[id]');
  if (firstSection) setActiveNav(firstSection.getAttribute('id'));
} else {
  const updateActiveNav = () => {
    let current = '';
    const scrollY = window.scrollY || window.pageYOffset || 0;
    sections.forEach(sec => {
      if (scrollY >= sec.offsetTop - 120) current = sec.getAttribute('id');
    });
    setActiveNav(current);
  };
  const requestNavUpdate = rafThrottle(updateActiveNav);
  window.addEventListener('scroll', requestNavUpdate, { passive: true });
  updateActiveNav();
}

// ===== RIPPLE on buttons =====
document.querySelectorAll('.btn-primary, .btn-card, .btn-card-action, .btn-add-cart, .btn-contact, .btn-header, .btn-ghost').forEach(btn => {
  btn.addEventListener('click', function(e) {
    const ripple = document.createElement('span');
    const rect = this.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.cssText = `
      position:absolute;
      width:${size}px;height:${size}px;
      left:${e.clientX - rect.left - size/2}px;
      top:${e.clientY - rect.top - size/2}px;
      background:rgba(255,255,255,0.25);
      border-radius:50%;
      transform:scale(0);
      animation:rippleAnim 0.55s linear;
      pointer-events:none;
    `;
    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
});

// Inject ripple keyframe dynamically
const rippleStyle = document.createElement('style');
rippleStyle.textContent = `@keyframes rippleAnim { to { transform:scale(2.5); opacity:0; } }`;
document.head.appendChild(rippleStyle);

// ===== MAGNETIC EFFECT on CTA buttons =====
if (pointerEffectsEnabled()) {
  document.querySelectorAll('.btn-primary, .btn-ghost').forEach(btn => {
    const updateMagnetic = rafThrottle((e) => {
      const rect = btn.getBoundingClientRect();
      const dx = (e.clientX - rect.left - rect.width  / 2) * 0.25;
      const dy = (e.clientY - rect.top  - rect.height / 2) * 0.25;
      btn.style.transform = `translate(${dx}px, ${dy}px) translateY(-3px)`;
    });
    btn.addEventListener('pointermove', updateMagnetic, { passive: true });
    btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
  });
}

// ===== SHOOTING STARS =====
function createShootingStar() {
  const star = document.createElement('div');
  star.className = 'shooting-star';
  const startX = Math.random() * window.innerWidth;
  const startY = Math.random() * window.innerHeight * 0.5;
  const angle = 30 + Math.random() * 20;
  const distance = 300 + Math.random() * 400;
  const tx = Math.cos((angle * Math.PI) / 180) * distance;
  const ty = Math.sin((angle * Math.PI) / 180) * distance;
  star.style.cssText = `
    left:${startX}px; top:${startY}px;
    --angle:${angle}deg; --tx:${tx}px; --ty:${ty}px;
    animation-duration:${0.6 + Math.random() * 0.6}s;
    box-shadow: 0 0 4px #fff, 0 0 8px rgba(232,67,147,0.6);
  `;
  document.body.appendChild(star);
  setTimeout(() => star.remove(), 1200);
}
const shootingStarInterval = finePointer() ? 4500 : 6000;
setInterval(createShootingStar, shootingStarInterval);

// ===== REAL-TIME SOCIAL PROOF TICKER & STATS BRIDGE =====
// Active ticker rendering is handled by live-ticker.js.
// This lightweight bridge maintains backward compatibility for window.__linkaddaToast without duplicate intervals or memory leaks.
(function() {
  const toastBridge = {
    setVisitorCount(count) {
      if (count !== undefined && !isNaN(Number(count)) && typeof window.updateMarqueeVisitors === 'function') {
        window.updateMarqueeVisitors({ today: Number(count) });
      }
    },
    setTelegramClicks(count) {
      if (count !== undefined && !isNaN(Number(count)) && typeof window.updateMarqueeTelegram === 'function') {
        window.updateMarqueeTelegram(Number(count));
      }
    },
    recordTelegramClick() {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const storedKey = `linkadda_tg_clicks_${today}`;
        const prev = Number(localStorage.getItem(storedKey) || 0) + 1;
        localStorage.setItem(storedKey, String(prev));
        if (typeof window.updateMarqueeTelegram === 'function') {
          window.updateMarqueeTelegram(prev);
        }
      } catch (_) {}
    },
    setApprovedOrders(orders) {
      if (Array.isArray(orders) && typeof window.updateMarqueeWithOrders === 'function') {
        window.updateMarqueeWithOrders(orders);
      }
    },
    setApprovedReviews(reviews) {
      if (Array.isArray(reviews) && typeof window.updateMarqueeReviews === 'function') {
        window.updateMarqueeReviews(reviews);
      }
    },
    addApprovedOrder(order) {
      if (!order) return;
      const title = typeof order === 'string' ? order : (order.name || order.productName || order.title || '');
      if (title && typeof window.addOrderToMarquee === 'function') {
        window.addOrderToMarquee(title);
      }
    },
    addApprovedReview(rev) {
      if (!rev) return;
      if (typeof window.updateMarqueeReviews === 'function') {
        window.updateMarqueeReviews([rev]);
      }
    },
    updateConfig(newSettings) {
      if (!newSettings || typeof newSettings !== 'object') return;
      if (Array.isArray(newSettings.recentApproved)) {
        this.setApprovedOrders(newSettings.recentApproved);
      }
      if (Array.isArray(newSettings.recentApprovedReviews)) {
        this.setApprovedReviews(newSettings.recentApprovedReviews);
      }
      if (newSettings.liveActivity) {
        if (newSettings.liveActivity.todayVisitors !== undefined) {
          this.setVisitorCount(newSettings.liveActivity.todayVisitors);
        }
        if (newSettings.liveActivity.telegramClicks !== undefined) {
          this.setTelegramClicks(newSettings.liveActivity.telegramClicks);
        }
      }
    },
    showToast() {},
    start() {}
  };

  window.__linkaddaToast = toastBridge;
})();

// ===== HERO SPOTLIGHT on mousemove =====
const heroSection = document.querySelector('.hero');
if (heroSection && pointerEffectsEnabled()) {
  const updateHeroSpotlight = rafThrottle((e) => {
    const rect = heroSection.getBoundingClientRect();
    heroSection.style.setProperty('--spotlight-x', (e.clientX - rect.left) + 'px');
    heroSection.style.setProperty('--spotlight-y', (e.clientY - rect.top) + 'px');
  });
  heroSection.addEventListener('pointermove', updateHeroSpotlight, { passive: true });
}



// ===== EXIT INTENT POPUP =====
(function() {
  // Don't show again in same session if already seen
  if (sessionStorage.getItem('exitShown')) return;

  // Build popup HTML
  const overlay = document.createElement('div');
  overlay.className = 'exit-overlay';
  overlay.innerHTML = `
    <div class="exit-popup">
      <button class="exit-close" id="exitClose"><i class="fa-solid fa-xmark"></i></button>
      <span class="exit-popup-icon">
        <i class="fa-solid fa-gem" style="background:linear-gradient(135deg,#f59e0b,#e84393);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;"></i>
      </span>
      <h2>Wait! Don't <span class="gradient-text">Miss This</span></h2>
      <p>You're leaving without grabbing the best deal in the market. Mega Pack — 3 Lac+ videos at an unbeatable price. Only for today!</p>
      <div class="exit-discount-box">
        <div class="old-price">Original Price: ₹10,900 / $392</div>
        <div class="new-price">₹4,399 <span style="font-size:1.1rem;opacity:0.8;">/ $109</span></div>
        <div class="save-tag">You save ₹6,501 — Cheapest in the market!</div>
      </div>
      <a href="https://t.me/VIP_KINK" target="_blank" class="btn-primary">
        <i class="fa-brands fa-telegram"></i> Claim Deal on Telegram
      </a>
      <button class="exit-skip" id="exitSkip">No thanks, I'll pay full price later</button>
    </div>
  `;
  document.body.appendChild(overlay);

  function showExitPopup() {
    if (sessionStorage.getItem('exitShown')) return;
    try {
      let b = window.liveCollections?.banner;
      if (!b) {
        const cached = localStorage.getItem('linkadda_cached_live_data_v4') || localStorage.getItem('linkadda_cached_live_data');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.banner) b = parsed.banner;
        }
      }
      if (b && (b.priceOfferINR || b.priceOriginal)) {
        const oldEl = overlay.querySelector('.old-price');
        const newEl = overlay.querySelector('.new-price');
        const saveEl = overlay.querySelector('.save-tag');
        const inr = b.priceOfferINR ? (String(b.priceOfferINR).startsWith('₹') ? b.priceOfferINR : '₹' + b.priceOfferINR) : '';
        const usd = b.priceOfferUSD ? (String(b.priceOfferUSD).startsWith('$') ? b.priceOfferUSD : '$' + b.priceOfferUSD) : '';
        const orig = b.priceOriginal ? (String(b.priceOriginal).startsWith('₹') ? b.priceOriginal : '₹' + b.priceOriginal) : '';
        if (orig && oldEl) oldEl.textContent = `Original Price: ${orig}`;
        if (inr && newEl) newEl.innerHTML = `${inr} ${usd ? `<span style="font-size:1.1rem;opacity:0.8;">/ ${usd}</span>` : ''}`;
        if (saveEl) saveEl.textContent = 'Special Mega Pack Deal — Cheapest in the market!';
      }
    } catch (_) {}
    overlay.classList.add('active');
    sessionStorage.setItem('exitShown', '1');
  }

  function closeExitPopup() {
    overlay.classList.remove('active');
  }

  // Trigger on mouse leaving to top of page
  document.addEventListener('mouseleave', (e) => {
    if (e.clientY <= 10) showExitPopup();
  });

  // Close buttons
  document.getElementById('exitClose').addEventListener('click', closeExitPopup);
  document.getElementById('exitSkip').addEventListener('click', closeExitPopup);

  // Close on overlay click outside popup
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeExitPopup();
  });

  // Also trigger on mobile with back button / visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sessionStorage.setItem('exitShown', '1');
    }
  });
})();

// ===== FAQ ACCORDION =====
document.querySelectorAll('.faq-item').forEach(item => {
  const btn = item.querySelector('.faq-q');
  btn.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');
    // close all
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
    // open clicked if it was closed
    if (!isOpen) item.classList.add('open');
  });
});

// ===== SCREENSHOT & COPY PROTECTION =====
(function() {
  // Skip protection on localhost so developer can inspect console errors
  const isLocal = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.hostname.startsWith('192.168.') ||
                  window.location.hostname.startsWith('10.') ||
                  window.location.hostname.endsWith('.local');
  if (isLocal) return;

  // Warning toast helper
  function showProtectToast(msg) {
    let t = document.querySelector('.protect-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'protect-toast';
      document.body.appendChild(t);
    }
    t.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${msg}`;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2500);
  }

  // Disable right click
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showProtectToast('Content is protected. Right click disabled.');
  });

  // Disable text selection via keyboard (Ctrl+A, Ctrl+C, Ctrl+U, Ctrl+S, F12)
  document.addEventListener('keydown', (e) => {
    const blocked = (
      (e.ctrlKey && ['a','c','u','s','p'].includes(e.key.toLowerCase())) ||
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && ['i','j','c'].includes(e.key.toLowerCase()))
    );
    if (blocked) {
      e.preventDefault();
      showProtectToast('Content is protected. This action is disabled.');
    }
  });

  // Disable drag
  document.addEventListener('dragstart', (e) => e.preventDefault());

  // Disable print
  window.addEventListener('beforeprint', (e) => {
    e.preventDefault();
    showProtectToast('Printing is disabled on this site.');
  });

  // DevTools open detection (basic)
  let devOpen = false;
  const devCheck = setInterval(() => {
    const threshold = 160;
    if (
      window.outerWidth - window.innerWidth > threshold ||
      window.outerHeight - window.innerHeight > threshold
    ) {
      if (!devOpen) {
        devOpen = true;
        showProtectToast('DevTools detected. Content is protected.');
      }
    } else {
      devOpen = false;
    }
  }, 1000);
})();

// ===== THEME MANAGER (DARK / LIGHT MODE & SYSTEM AUTO-DEDICATION) =====
(function() {
  const THEME_KEY = 'linkadda_theme';
  const MANUAL_KEY = 'linkadda_theme_manual';

  function getSystemTheme() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch (_) {}
    return 'light';
  }

  function getActiveTheme() {
    try {
      const isManual = localStorage.getItem(MANUAL_KEY);
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (isManual && savedTheme) {
        return savedTheme;
      }
    } catch (_) {}
    return 'light';
  }

  function updateButtonUI(theme) {
    const toggleBtn = document.getElementById('themeToggleBtn');
    const label = document.getElementById('themeToggleLabel');
    if (toggleBtn) {
      if (theme === 'light') {
        toggleBtn.classList.add('is-light');
        if (label) label.textContent = 'Dark Mode';
      } else {
        toggleBtn.classList.remove('is-light');
        if (label) label.textContent = 'Light Mode';
      }
    }
  }

  function applyTheme(theme, isManualAction) {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);

    if (isManualAction) {
      try {
        localStorage.setItem(MANUAL_KEY, 'true');
        localStorage.setItem(THEME_KEY, theme);
      } catch (_) {}
    }

    updateButtonUI(theme);
    window.dispatchEvent(new CustomEvent('linkadda:themechange', { detail: { theme } }));
  }

  function initTheme() {
    const initialTheme = getActiveTheme();
    applyTheme(initialTheme, false);

    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function(e) {
        e.preventDefault();
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'light' ? 'dark' : 'light';
        applyTheme(next, true);
      });
    }

    // Auto-listen to system device changes in real-time
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
      const handleSystemChange = function(e) {
        try {
          const isManual = localStorage.getItem(MANUAL_KEY);
          // Follow system theme if the user hasn't explicitly set manual preference
          if (!isManual) {
            const systemTheme = e.matches ? 'light' : 'dark';
            applyTheme(systemTheme, false);
          }
        } catch (_) {}
      };

      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleSystemChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleSystemChange);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
})();
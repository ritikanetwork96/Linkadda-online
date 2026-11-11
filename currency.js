/**
 * LinkAdda Unified Hybrid Currency & Geolocation Engine
 * 
 * Tier 1: 0ms Timezone & Device Locale (Zero flicker, instant client-side detection)
 * Tier 2: Background IP Geolocation check (High-precision country verification)
 * Tier 3: Manual Switcher Override (Header pill & localStorage persistence)
 */

(function () {
  'use strict';

  var STORAGE_KEY_CURRENCY = 'linkadda_store_currency';
  var STORAGE_KEY_MANUAL = 'linkadda_currency_manual';
  var STORAGE_KEY_COUNTRY = 'linkadda_geo_country';
  var STORAGE_KEY_GEO_TIME = 'linkadda_geo_time';
  var GEO_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days cache

  // 1. Tier 1: Instant 0ms Timezone & Locale Detection
  function detectTier1Country() {
    try {
      // Check device timezone
      var tz = '';
      if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      }
      if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') {
        return 'IN';
      }

      // Check timezone offset (+05:30 is India Standard Time, offset is -330)
      var offsetMinutes = -(new Date().getTimezoneOffset());
      if (offsetMinutes === 330) {
        return 'IN';
      }

      // Check browser locale
      var lang = ((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
      if (lang.indexOf('-in') !== -1 || lang === 'hi' || lang.indexOf('hi-') === 0) {
        return 'IN';
      }

      // Check Telegram WebApp user language
      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe) {
        var tgUser = window.Telegram.WebApp.initDataUnsafe.user;
        if (tgUser && (tgUser.language_code === 'hi' || tgUser.language_code === 'ta' || tgUser.language_code === 'te' || tgUser.language_code === 'mr')) {
          return 'IN';
        }
      }
    } catch (_) {}

    return 'GLOBAL';
  }

  // Check URL query parameters (e.g. ?currency=USD or ?currency=INR)
  function getUrlCurrencyOverride() {
    try {
      var params = new URLSearchParams(window.location.search);
      var c = (params.get('currency') || '').toUpperCase().trim();
      if (c === 'INR' || c === 'USD') return c;
    } catch (_) {}
    return null;
  }

  // 2. Initialize Initial Currency State
  var savedCurrency = null;
  var isManualChoice = false;

  try {
    savedCurrency = localStorage.getItem(STORAGE_KEY_CURRENCY);
    isManualChoice = localStorage.getItem(STORAGE_KEY_MANUAL) === '1';
  } catch (_) {}

  var activeCurrency = 'INR';
  var detectedCountry = 'IN';

  var urlOverride = getUrlCurrencyOverride();
  if (urlOverride) {
    activeCurrency = urlOverride;
    isManualChoice = true;
  } else if (savedCurrency === 'INR' || savedCurrency === 'USD') {
    activeCurrency = savedCurrency;
  } else {
    // Fresh visitor: Run Tier 1 Detection
    var tier1 = detectTier1Country();
    detectedCountry = tier1;
    activeCurrency = (tier1 === 'IN') ? 'INR' : 'USD';
  }

  // 3. Apply DOM Attributes and Styling
  function applyCurrencyToDOM(curr) {
    if (typeof document === 'undefined') return;
    try {
      document.documentElement.setAttribute('data-currency', curr);
      if (document.body) {
        document.body.setAttribute('data-currency', curr);
      }

      // Update Header currency button
      var headerBtn = document.getElementById('headerCurrencyBtn');
      var headerFlag = document.getElementById('headerCurrencyFlag');
      var headerCode = document.getElementById('headerCurrencyCode');
      if (headerFlag && headerCode) {
        headerFlag.textContent = (curr === 'INR') ? '🇮🇳' : '🌐';
        headerCode.textContent = (curr === 'INR') ? 'INR (₹)' : 'USDT ($)';
      }
      if (headerBtn) {
        headerBtn.setAttribute('data-currency', curr);
        headerBtn.setAttribute('title', curr === 'INR' ? 'Current: ₹ INR (Click to switch to USDT)' : 'Current: $ USDT (Click to switch to INR)');
      }

      // Update Mobile Drawer currency toggle
      var mobToggleText = document.getElementById('mobCurrencyToggleText');
      if (mobToggleText) {
        mobToggleText.textContent = (curr === 'INR') ? 'Currency: 🇮🇳 ₹ INR' : 'Currency: 🌐 $ USDT';
      }

      // Update Profile / Settings currency display
      var profilePill = document.querySelector('.profile-currency-pill');
      if (profilePill) {
        profilePill.textContent = (curr === 'INR') ? '🇮🇳 ₹ INR' : '🌐 $ USDT';
      }
    } catch (_) {}
  }

  // 4. Set & Switch Currency
  function setStoreCurrency(newCurr, manual) {
    if (newCurr !== 'INR' && newCurr !== 'USD') return;
    activeCurrency = newCurr;
    if (manual) {
      isManualChoice = true;
      try {
        localStorage.setItem(STORAGE_KEY_MANUAL, '1');
        localStorage.setItem(STORAGE_KEY_CURRENCY, newCurr);
      } catch (_) {}
    } else {
      try {
        localStorage.setItem(STORAGE_KEY_CURRENCY, newCurr);
      } catch (_) {}
    }

    applyCurrencyToDOM(newCurr);

    // Notify all app components (cards, carts, checkout)
    try {
      window.dispatchEvent(new CustomEvent('currencyChange', {
        detail: {
          currency: newCurr,
          isINR: newCurr === 'INR',
          isUSD: newCurr === 'USD',
          isManual: Boolean(manual)
        }
      }));
    } catch (_) {}
  }

  function toggleStoreCurrency() {
    var next = (activeCurrency === 'INR') ? 'USD' : 'INR';
    setStoreCurrency(next, true);

    // Show lightweight toast alert if available
    try {
      if (typeof window.showToast === 'function') {
        window.showToast(next === 'INR' ? '🇮🇳 Currency switched to Indian Rupee (₹ INR)' : '🌐 Currency switched to Crypto (USDT / $ USD)', 'info');
      }
    } catch (_) {}
  }

  // 5. Tier 2: Background IP Geolocation Check (Runs async without blocking)
  function runTier2BackgroundGeo() {
    if (isManualChoice) return; // User explicitly selected preference, do not override

    try {
      var cachedGeo = localStorage.getItem(STORAGE_KEY_COUNTRY);
      var cachedTime = Number(localStorage.getItem(STORAGE_KEY_GEO_TIME) || 0);
      var now = Date.now();

      if (cachedGeo && (now - cachedTime < GEO_CACHE_TTL_MS)) {
        // Cache is fresh, apply if not manual
        if (!isManualChoice) {
          var expectedCurr = (cachedGeo === 'IN') ? 'INR' : 'USD';
          if (expectedCurr !== activeCurrency) {
            setStoreCurrency(expectedCurr, false);
          }
        }
        return;
      }
    } catch (_) {}

    // Async fetch from lightweight public Geo-IP APIs with timeout
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var signal = controller ? controller.signal : undefined;
    var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 3500) : null;

    fetch('https://api.country.is/', { signal: signal })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (timeoutId) clearTimeout(timeoutId);
        var country = (data && data.country) ? String(data.country).toUpperCase().trim() : '';
        if (country) {
          try {
            localStorage.setItem(STORAGE_KEY_COUNTRY, country);
            localStorage.setItem(STORAGE_KEY_GEO_TIME, String(Date.now()));
          } catch (_) {}

          if (!isManualChoice) {
            var resolvedCurr = (country === 'IN') ? 'INR' : 'USD';
            if (resolvedCurr !== activeCurrency) {
              setStoreCurrency(resolvedCurr, false);
            }
          }
        }
      })
      .catch(function () {
        // Fallback to secondary geo endpoint if first fails
        fetch('https://ipapi.co/country/', { signal: signal })
          .then(function (res) { return res.text(); })
          .then(function (txt) {
            if (timeoutId) clearTimeout(timeoutId);
            var country = (txt || '').trim().toUpperCase();
            if (country && country.length === 2) {
              try {
                localStorage.setItem(STORAGE_KEY_COUNTRY, country);
                localStorage.setItem(STORAGE_KEY_GEO_TIME, String(Date.now()));
              } catch (_) {}

              if (!isManualChoice) {
                var resolvedCurr = (country === 'IN') ? 'INR' : 'USD';
                if (resolvedCurr !== activeCurrency) {
                  setStoreCurrency(resolvedCurr, false);
                }
              }
            }
          })
          .catch(function () {});
      });
  }

  // 6. Format Money Utility
  function formatStorePrice(inrVal, usdVal) {
    var inrNum = Number(String(inrVal || '').replace(/[^0-9.]/g, '')) || 0;
    var usdNum = Number(String(usdVal || '').replace(/[^0-9.]/g, '')) || 0;

    if (activeCurrency === 'USD') {
      var usdDisplay = usdNum ? usdNum.toLocaleString('en-US') : Math.round(inrNum / 85) || 1;
      return '$' + usdDisplay + ' USDT';
    }
    return '₹' + inrNum.toLocaleString('en-IN');
  }

  // Expose to global window
  window.getStoreCurrency = function () { return activeCurrency; };
  window.isIndiaVisitor = function () { return activeCurrency === 'INR'; };
  window.setStoreCurrency = setStoreCurrency;
  window.toggleStoreCurrency = toggleStoreCurrency;
  window.formatStorePrice = formatStorePrice;
  window.getDetectedCountry = function () { return detectedCountry; };

  // Run initial DOM application immediately
  applyCurrencyToDOM(activeCurrency);

  // Hook into DOMContentLoaded for elements that render later
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      applyCurrencyToDOM(activeCurrency);
      runTier2BackgroundGeo();
    });
  } else {
    applyCurrencyToDOM(activeCurrency);
    setTimeout(runTier2BackgroundGeo, 100);
  }
})();

/* ══════════════════════════════════════════════════════════
   LE FOUR — analytics, SEO & campaign attribution
   Loads GA4 / GTM / Meta Pixel / Clarity from editable settings,
   captures UTM attribution and exposes window.lfTrack(event, params).
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  window.dataLayer = window.dataLayer || [];
  window.LF_SETTINGS = window.LF_SETTINGS || null;

  /* ── UTM / campaign attribution ────────────────────────── */
  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const CLICK_IDS = ['gclid', 'fbclid', 'ttclid', 'msclkid'];

  function readAttribution() {
    const q = new URLSearchParams(location.search);
    const hit = {};
    UTM_KEYS.concat(CLICK_IDS).forEach(k => { const v = q.get(k); if (v) hit[k] = v; });
    if (!Object.keys(hit).length && document.referrer) {
      try {
        const rh = new URL(document.referrer).hostname.replace(/^www\./, '');
        if (rh && rh !== location.hostname) hit.referrer = rh;
      } catch (e) { /* ignore */ }
    }
    return hit;
  }

  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }

  const hit = readAttribution();
  if (Object.keys(hit).length) {
    hit.ts = new Date().toISOString();
    if (!load('lf-first-touch')) store('lf-first-touch', hit);   // first ever source
    store('lf-last-touch', hit);                                  // most recent source
  }
  const firstTouch = load('lf-first-touch') || {};
  const lastTouch = load('lf-last-touch') || {};

  function attribution() {
    return {
      source: lastTouch.utm_source || lastTouch.referrer || 'direct',
      medium: lastTouch.utm_medium || (lastTouch.referrer ? 'referral' : 'none'),
      campaign: lastTouch.utm_campaign || '(none)',
      content: lastTouch.utm_content || '',
      first_source: firstTouch.utm_source || firstTouch.referrer || 'direct',
      first_campaign: firstTouch.utm_campaign || '(none)',
    };
  }
  window.lfAttribution = attribution;

  /* ── script loaders ────────────────────────────────────── */
  function inject(src, attrs) {
    const s = document.createElement('script');
    s.async = true; s.src = src;
    Object.entries(attrs || {}).forEach(([k, v]) => s.setAttribute(k, v));
    document.head.appendChild(s);
    return s;
  }

  function loadGA4(id) {
    if (!/^G-[A-Z0-9]+$/i.test(id)) return;
    inject('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id));
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', id, { send_page_view: true });
  }

  function loadGTM(id) {
    if (!/^GTM-[A-Z0-9]+$/i.test(id)) return;
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    inject('https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(id));
  }

  function loadPixel(id) {
    if (!/^\d{6,20}$/.test(id)) return;
    /* standard Meta Pixel bootstrap */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', id);
    fbq('track', 'PageView');
  }

  function loadClarity(id) {
    if (!/^[a-z0-9]{6,20}$/i.test(id)) return;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', id);
  }

  function setVerification(tokenValue) {
    if (!tokenValue) return;
    let m = document.querySelector('meta[name="google-site-verification"]');
    if (!m) { m = document.createElement('meta'); m.name = 'google-site-verification'; document.head.appendChild(m); }
    m.content = tokenValue;
  }

  /* ── the single tracking entry point ───────────────────── */
  const queue = [];
  window.lfTrack = function (event, params) {
    const payload = Object.assign({ event: event }, attribution(), params || {});
    window.dataLayer.push(payload);                                  // GTM
    if (typeof window.gtag === 'function') {
      const p = Object.assign({}, payload); delete p.event;
      window.gtag('event', event, p);                                // GA4
    }
    if (typeof window.fbq === 'function') {
      const META = {
        order_online: 'InitiateCheckout', whatsapp_click: 'Contact', call_click: 'Contact',
        catering_submit: 'Lead', contact_submit: 'Lead', uber_eats_click: 'InitiateCheckout',
        doordash_click: 'InitiateCheckout', view_menu: 'ViewContent', view_item: 'ViewContent',
      };
      META[event] ? window.fbq('track', META[event], params || {}) : window.fbq('trackCustom', event, params || {});
    }
    if (typeof window.clarity === 'function') {
      try { window.clarity('event', event); } catch (e) {}
    }
    queue.push(payload);
    if (queue.length > 60) queue.shift();
  };
  window.lfTrackQueue = queue;

  /* auto-track outbound + tel links that carry a data-track attribute */
  document.addEventListener('click', function (e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-track]') : null;
    if (el) window.lfTrack(el.dataset.track, { link_url: el.getAttribute('href') || '' });
  }, true);

  /* ── boot: pull editable settings, then start everything ─ */
  fetch('/api/settings', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      const s = (j && j.settings) || {};
      window.LF_SETTINGS = s;
      loadGTM(s.gtm || '');
      loadGA4(s.ga4 || '');
      loadPixel(s.metaPixel || '');
      loadClarity(s.clarity || '');
      setVerification(s.gscVerify || '');
      document.dispatchEvent(new CustomEvent('lf-settings', { detail: s }));
    })
    .catch(() => document.dispatchEvent(new CustomEvent('lf-settings', { detail: {} })));
})();

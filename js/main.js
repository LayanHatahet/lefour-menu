/* ══════════════════════════════════════════════════════════
   LE FOUR — QR menu (mobile-first)
   i18n · tabs · filters · cards · bottom sheet
   ══════════════════════════════════════════════════════════ */

'use strict';

const NL = String.fromCharCode(10);
const DASH = String.fromCharCode(8212);
const JOINSAFE = (i) => String.fromCharCode(8226) + ' ' + i.name + ' ' + String.fromCharCode(215) + ' ' + i.q;

const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/* ───────────── monoline ink illustrations ─────────────── */
function blobD(cx, cy, r, rnd, irr = .06, n = 10) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 - irr + rnd() * irr * 2);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m = mid(pts[0], pts[1]);
  let d = `M${m[0].toFixed(1)},${m[1].toFixed(1)}`;
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n], m2 = mid(p, pts[(i + 1) % n]);
    d += `Q${p[0].toFixed(1)},${p[1].toFixed(1)} ${m2[0].toFixed(1)},${m2[1].toFixed(1)}`;
  }
  return d + 'Z';
}
function scat(rnd, cx, cy, R, n, fn) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R;
    out += fn(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, rnd, i);
  }
  return out;
}
const P  = (d, w = 2.2) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const DOT = (x, y, r = 1.7) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="currentColor"/>`;
const RING = (x, y, r, w = 2.2) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="none" stroke="currentColor" stroke-width="${w}"/>`;
const dashMark = (x, y, a, l = 7) => {
  const dx = Math.cos(a) * l / 2, dy = Math.sin(a) * l / 2;
  return P(`M${(x - dx).toFixed(1)},${(y - dy).toFixed(1)} L${(x + dx).toFixed(1)},${(y + dy).toFixed(1)}`, 2);
};
const vMark = (x, y, a) =>
  `<path d="M-5,2 L0,-3 L5,2" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(a * 57.3).toFixed(0)})" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const leafMark = (x, y, rot, s = 1) =>
  `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${s})">` +
  P('M0,-7 C4.5,-3.5 4.5,3.5 0,7 C-4.5,3.5 -4.5,-3.5 0,-7 Z M0,-5 L0,5', 1.8) + '</g>';
const spiral = (cx, cy, rmax, turns = 2.4) => {
  let d = `M${cx + rmax},${cy}`;
  const steps = 46;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const r = rmax * (1 - t * .82);
    d += `L${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
  }
  return d;
};

function base(shape, rnd) {
  switch (shape) {
    case 'boat':
      return P('M22,100 C52,62 148,62 178,100 C148,136 52,136 22,100 Z')
           + P('M40,100 C64,72 136,72 160,100 C136,126 64,126 40,100 Z', 1.6)
           + DOT(26, 99, 2) + DOT(174, 99, 2);
    case 'triangle':
      return P('M100 30 L34 158 L166 158 Z') + P('M100 50 L54 146 L146 146 Z', 1.6);
    case 'square':
      return `<g transform="rotate(-2 100 100)">` + P('M40,40 h120 a12,12 0 0 1 12,12 v96 a12,12 0 0 1 -12,12 h-120 a12,12 0 0 1 -12,-12 v-96 a12,12 0 0 1 12,-12 Z')
           + P('M54,54 h92 a8,8 0 0 1 8,8 v76 a8,8 0 0 1 -8,8 h-92 a8,8 0 0 1 -8,-8 v-76 a8,8 0 0 1 8,-8 Z', 1.6) + `</g>`;
    default:
      return P(blobD(100, 100, 80, rnd, .045)) + P(blobD(100, 100, 62, rnd, .06), 1.6);
  }
}

function marks(style, rnd) {
  const cx = 100, cy = 100;
  const meltBlobs = (n, R = 40, r0 = 10) => scat(rnd, cx, cy, R, n, (x, y, r2) => P(blobD(x, y, r0 + r2() * 5, r2, .25, 7), 1.8));
  const dots = (n, R = 48) => scat(rnd, cx, cy, R, n, (x, y) => DOT(x, y, 1.6));
  const dashes = (n, R = 46) => scat(rnd, cx, cy, R, n, (x, y, r2) => dashMark(x, y, r2() * Math.PI));
  const vs = (n, R = 42) => scat(rnd, cx, cy, R, n, (x, y, r2) => vMark(x, y, r2() * Math.PI));

  switch (style) {
    case 'speckle':        return dots(24) + dashes(9);
    case 'half':
      return P(`M100,${cy - 58} L100,${cy + 58}`, 1.6)
        + scat(rnd, 68, cy, 26, 12, (x, y) => DOT(x, y, 1.6))
        + P(blobD(132, 82, 11, rnd, .25, 7), 1.8) + P(blobD(126, 116, 10, rnd, .25, 7), 1.8);
    case 'melt':           return meltBlobs(4) + dots(6, 52);
    case 'discs':          return scat(rnd, cx, cy, 40, 6, (x, y) => RING(x, y, 8.5, 2) + DOT(x, y, 1.8)) + dots(5, 52);
    case 'mince':          return vs(11) + dots(7, 50);
    case 'mince-melt':     return vs(7) + meltBlobs(3, 42);
    case 'sfiha':          return `<g transform="rotate(-2 100 100)">` + vs(7, 34) + dots(6, 36) + `</g>`;
    case 'spread':         return P(spiral(cx, cy, 44), 1.8) + dots(7, 50);
    case 'spread-melt':    return P(spiral(cx, cy, 44), 1.8) + meltBlobs(2, 34);
    case 'boat':           return RING(80, 100, 8, 2) + DOT(80, 100, 2) + RING(122, 102, 8, 2) + DOT(122, 102, 2) + scat(rnd, cx, 100, 34, 7, (x, y) => DOT(x, y, 1.4));
    case 'triangle':       return P('M100 58 L100 140 M100 140 L62 140 M100 140 L138 140', 1.6) + scat(rnd, 100, 116, 22, 6, (x, y) => DOT(x, y, 1.7));
    case 'triangle-melt':  return P('M100 58 L100 140', 1.6) + P(blobD(82, 122, 10, rnd, .25, 7), 1.8) + P(blobD(120, 118, 10, rnd, .25, 7), 1.8) + scat(rnd, 100, 110, 20, 4, (x, y) => DOT(x, y, 1.6));
    case 'kishik':         return scat(rnd, cx, cy, 38, 4, (x, y) => RING(x, y, 6, 1.8)) + dots(10, 48);
    case 'kawerma':        return vs(7, 40) + RING(76, 88, 8.5, 2) + DOT(76, 88, 2) + RING(128, 114, 8.5, 2) + DOT(128, 114, 2);
    case 'duplex': {
      let ring = '';
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ring += DOT(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52, 1.6); }
      return ring + P(blobD(cx, cy, 26, rnd, .12, 8), 1.8) + dots(3, 16);
    }
    case 'choco':
      return P(spiral(cx, cy, 42, 2), 1.8)
        + `<ellipse cx="72" cy="82" rx="10" ry="6.5" fill="none" stroke="currentColor" stroke-width="1.8" transform="rotate(-18 72 82)"/>`
        + `<ellipse cx="130" cy="118" rx="10" ry="6.5" fill="none" stroke="currentColor" stroke-width="1.8" transform="rotate(14 130 118)"/>`
        + dots(5, 50);
    case 'makdous':
      return `<ellipse cx="78" cy="88" rx="13" ry="8.5" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-16 78 88)"/>`
        + `<ellipse cx="124" cy="96" rx="13" ry="8.5" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(22 124 96)"/>`
        + `<ellipse cx="98" cy="124" rx="13" ry="8.5" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-6 98 124)"/>`
        + leafMark(134, 70, 40, .8) + leafMark(64, 118, -30, .8) + dots(5, 48);
    case 'sharhat': {
      let s = '';
      for (let i = 0; i < 5; i++) {
        const y = 70 + i * 16, w = 56 + rnd() * 28, x = 100 - w / 2 + (rnd() - .5) * 10;
        s += P(`M${x.toFixed(0)},${y} q${(w / 4).toFixed(0)},-5 ${(w / 2).toFixed(0)},0 t${(w / 2).toFixed(0)},0`, 2);
      }
      return s;
    }
    default: return dots(16);
  }
}

function pizzaInk(item) {
  const rnd = seeded(item.id);
  const cx = 100, cy = 100;
  let s = P(blobD(cx, cy, 82, rnd, .03)) + P(blobD(cx, cy, 66, rnd, .04), 1.6);
  const dots = (n, R = 50) => scat(rnd, cx, cy, R, n, (x, y) => DOT(x, y, 1.6));
  const leaves = (n, R = 46) => scat(rnd, cx, cy, R, n, (x, y, r2) => leafMark(x, y, r2() * 360, .9));
  const rings = (n, r = 8, R = 46) => scat(rnd, cx, cy, R, n, (x, y) => RING(x, y, r, 2) + DOT(x, y, 1.7));
  const mush = (x, y, rot) => `<g transform="translate(${x} ${y}) rotate(${rot})">` + P('M-8,0 A8,8 0 0 1 8,0 Z M-2,0 L-2,7 M2,0 L2,7', 1.8) + `</g>`;
  const oliveRings = (n, R = 48) => scat(rnd, cx, cy, R, n, (x, y) => RING(x, y, 4, 1.8));
  const drizzle = P('M46,84 q28,20 108,8 M52,114 q36,16 100,-4', 1.8);

  switch (item.art.style) {
    case 'pizza-margherita': s += leaves(5) + dots(8); break;
    case 'pizza-sujuk':      s += rings(6, 8) + dots(6, 54); break;
    case 'pizza-quattro':    s += P('M100,36 L100,164 M36,100 L164,100', 1.4) + P(blobD(72, 72, 11, rnd, .2, 7), 1.8) + P(blobD(130, 74, 9, rnd, .2, 7), 1.8) + P(blobD(70, 128, 9, rnd, .2, 7), 1.8) + P(blobD(130, 128, 11, rnd, .2, 7), 1.8); break;
    case 'pizza-musakhan':   s += scat(rnd, cx, cy, 42, 7, (x, y, r2) => vMark(x, y, r2() * Math.PI)) + scat(rnd, cx, cy, 48, 5, (x, y) => P(`M${x - 8},${y} q8,-7 16,0`, 1.8)) + dots(6, 52); break;
    case 'pizza-pastrami':   s += scat(rnd, cx, cy, 42, 5, (x, y, r2) => `<rect x="${x - 10}" y="${y - 5.5}" width="20" height="11" rx="4.5" fill="none" stroke="currentColor" stroke-width="1.8" transform="rotate(${(r2() * 160).toFixed(0)} ${x} ${y})"/>`) + oliveRings(5) + dots(4, 54); break;
    case 'pizza-shawarma':   s += scat(rnd, cx, cy, 44, 9, (x, y, r2) => dashMark(x, y, r2() * Math.PI, 12)) + drizzle + leaves(3, 52); break;
    case 'pizza-falafel':    s += scat(rnd, cx, cy, 40, 5, (x, y) => RING(x, y, 9, 2) + DOT(x - 2.5, y - 1.5, 1.1) + DOT(x + 2.5, y + 1.8, 1.1)) + RING(132, 70, 11, 1.8) + P('M132,59 L132,81 M121,70 L143,70 M124.5,62.5 L139.5,77.5 M139.5,62.5 L124.5,77.5', 1.2) + leaves(3, 54); break;
    case 'pizza-garden':     s += rings(3, 7) + mush(126, 118, 12) + mush(72, 120, -8) + leaves(3, 50) + oliveRings(4, 52); break;
    case 'pizza-turkey':     s += mush(84, 84, -10) + mush(124, 124, 16) + scat(rnd, cx, cy, 46, 4, (x, y, r2) => `<g transform="translate(${x} ${y}) rotate(${(r2() * 90).toFixed(0)})">` + P('M0,-8 L4,0 L0,8 L-4,0 Z', 1.6) + `</g>`) + oliveRings(4, 54); break;
    default:                 s += scat(rnd, cx, cy, 48, 8, (x, y, r2) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="2.6" fill="none" stroke="currentColor" stroke-width="1.6" transform="rotate(${(r2() * 180).toFixed(0)} ${x} ${y})"/>`) + dots(10, 54) + leaves(2, 50);
  }
  return s;
}

function drinkInk(item) {
  switch (item.art.style) {
    case 'cup': /* café / thé : tasse + soucoupe + vapeur */
      return P('M62,84 h76 l-7,48 a13,13 0 0 1 -13,11 h-36 a13,13 0 0 1 -13,-11 z')
        + P('M138,92 q20,2 16,20 q-3,14 -20,13', 1.9)
        + P('M52,152 h96', 1.9)
        + P('M85,66 q5,-9 0,-18 M101,70 q5,-9 0,-18 M117,66 q5,-9 0,-18', 1.6);
    case 'glass': /* ayran : verre + paille + bulles */
      return P('M72,52 L82,148 a9,9 0 0 0 9,8 h18 a9,9 0 0 0 9,-8 L128,52 z')
        + P('M76,88 h48', 1.6)
        + P('M114,32 L102,66', 1.9)
        + DOT(92, 112, 2) + DOT(104, 126, 2) + DOT(98, 98, 1.6);
    case 'can': /* canette */
      return P('M74,62 h52 a6,6 0 0 1 6,6 v76 a10,10 0 0 1 -10,10 h-44 a10,10 0 0 1 -10,-10 v-76 a6,6 0 0 1 6,-6 z')
        + `<ellipse cx="100" cy="62" rx="26" ry="7" fill="none" stroke="currentColor" stroke-width="2.2"/>`
        + `<ellipse cx="100" cy="59" rx="9" ry="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/>`
        + P('M80,96 h40', 1.6) + DOT(84, 122, 1.6) + DOT(112, 130, 1.6);
    default: /* bottle */
      return P('M90,36 h20 v16 q16,12 16,28 v56 a12,12 0 0 1 -12,12 h-28 a12,12 0 0 1 -12,-12 v-56 q16,-16 16,-28 z')
        + P('M88,30 h24', 2.4)
        + P('M82,104 h36', 1.6) + P('M82,120 h36', 1.6)
        + DOT(100, 86, 1.8);
  }
}

function inkArt(item, kind) {
  const rnd = seeded(item.id);
  let inner = '';
  if (kind === 'drink') inner = drinkInk(item);
  else if (kind === 'pizza') inner = pizzaInk(item);
  else if (kind === 'mezze') {
    inner = P('M36,84 L184,84 Q180,138 110,142 Q40,138 36,84 Z')
      + P('M92,142 L88,154 L132,154 L128,142', 1.8)
      + P('M52,84 Q80,72 110,80 T168,82', 1.8)
      + `<ellipse cx="110" cy="76" rx="16" ry="5" fill="none" stroke="currentColor" stroke-width="1.8"/>`
      + P('M84,56 q5,-8 0,-16 M112,60 q5,-8 0,-16 M138,56 q5,-8 0,-16', 1.6)
      + (item.id === 'muhamara-dip' ? DOT(70, 80, 1.8) + DOT(150, 80, 1.8) : leafMark(66, 80, -20, .7) + leafMark(154, 80, 30, .7));
  } else if (kind === 'mini') {
    inner = P(blobD(58, 108, 26, rnd, .07, 9)) + DOT(58, 108, 2.2)
      + P(blobD(106, 92, 30, rnd, .07, 9)) + DOT(106, 92, 2.2)
      + P(blobD(152, 110, 24, rnd, .07, 9)) + DOT(152, 110, 2.2)
      + P('M40,148 L172,148', 1.4);
  } else {
    inner = base(item.art.shape || 'round', rnd) + marks(item.art.style, rnd);
  }
  return `<svg viewBox="0 0 200 200" aria-hidden="true">${inner}</svg>`;
}

/* ─────────────────────────── i18n ──────────────────────── */
let PHOTOS = { dishes: {}, gallery: [] };

/* texte alternatif éditable depuis le tableau de bord (SEO images) */
function altFor(key, fallback) {
  const s = window.LF_SETTINGS;
  const v = s && s.alt ? s.alt[key] : '';
  return (v && String(v).trim()) || fallback || '';
}

async function loadPhotos() {
  try {
    const r = await fetch('/api/photos', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    PHOTOS = { dishes: j.dishes || {}, gallery: j.gallery || [] };
    renderMenu();
    renderGallery();
  } catch (e) { /* pas de photos : on garde les illustrations */ }
}

function renderGallery() {
  const sec = $('#gallery'), strip = $('#galStrip');
  if (!sec || !strip) return;
  if (!PHOTOS.gallery.length) { sec.hidden = true; return; }
  sec.hidden = false;
  strip.innerHTML = PHOTOS.gallery.map((u, i) =>
    `<figure class="gal-item"><img src="${u}" alt="${altFor('gallery:' + u, 'Boulangerie Le Four — Pierrefonds')}" loading="lazy" decoding="async"></figure>`).join('');
}

const urlLang = new URLSearchParams(location.search).get('lang');
let lang = (urlLang && UI[urlLang]) ? urlLang : (localStorage.getItem('lefour-lang') || 'fr');

const FILTER_ALL = { fr: 'Tout', en: 'All', ar: 'الكل' };
const SIZES_HINT = { fr: ['option', 'options'], en: ['option', 'options'], ar: ['خيار', 'خيارات'] };

function t(key) { return UI[lang][key] ?? UI.fr[key] ?? key; }

function fmtPrice(n) {
  if (n == null) return '';
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (lang === 'fr') return `${s.replace('.', ',')} $`;
  return `‎$${s}‎`;
}


/* ── données structurées du menu (rich results) ─────────── */
function injectMenuSchema() {
  try {
    const secs = CATS.map(c => ({
      '@type': 'MenuSection',
      name: t(titleKey[c.key]),
      hasMenuItem: (MENU[c.key] || []).map(it => {
        const item = { '@type': 'MenuItem', name: it.name[lang], description: it.desc[lang] || '' };
        if (it.price != null) item.offers = { '@type': 'Offer', price: String(it.price), priceCurrency: 'CAD' };
        if (it.tags && it.tags.includes('veg')) item.suitableForDiet = 'https://schema.org/VegetarianDiet';
        return item;
      }),
    }));
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Menu',
      '@id': location.origin + '/#menu',
      name: t('carteTitle') || 'Menu',
      inLanguage: lang,
      hasMenuSection: secs,
    };
    let el = document.getElementById('ldMenu');
    if (!el) { el = document.createElement('script'); el.type = 'application/ld+json'; el.id = 'ldMenu'; document.head.appendChild(el); }
    el.textContent = JSON.stringify(data);
  } catch (e) { /* le JSON-LD du commerce reste en place */ }
}

function applySeo() {
  const st = window.LF_SETTINGS;
  if (!st) return;
  const pick = (o) => (o && (o[lang] || o.fr || o.en)) || '';
  const title = pick(st.seoTitle), desc = pick(st.seoDesc);
  const set = (sel, attr, val) => { const el = document.querySelector(sel); if (el && val) el.setAttribute(attr, val); };
  if (title) { document.title = title; set('meta[property="og:title"]', 'content', title); set('meta[name="twitter:title"]', 'content', title); }
  if (desc) { set('meta[name="description"]', 'content', desc); set('meta[property="og:description"]', 'content', desc); set('meta[name="twitter:description"]', 'content', desc); }
  if (st.keywords) set('meta[name="keywords"]', 'content', st.keywords);
  if (st.ogImage) { set('meta[property="og:image"]', 'content', st.ogImage); set('meta[name="twitter:image"]', 'content', st.ogImage); }
  const ld = document.getElementById('ldBusiness');
  if (ld) {
    try {
      const j = JSON.parse(ld.textContent);
      if (st.bizName) j.name = st.bizName;
      if (st.phone) j.telephone = st.phone;
      if (st.email) j.email = st.email;
      if (st.ogImage) j.image = st.ogImage;
      const sameAs = [st.instagram, st.facebook, st.tiktok].filter(Boolean);
      if (sameAs.length) j.sameAs = sameAs;
      ld.textContent = JSON.stringify(j);
    } catch (e) { /* garder le JSON-LD statique */ }
  }
  const loc = { fr: 'fr_CA', en: 'en_CA', ar: 'ar_AR' }[lang] || 'fr_CA';
  set('meta[property="og:locale"]', 'content', loc);
}

function applyI18n() {
  document.documentElement.lang = lang;
  document.documentElement.dir = UI[lang].dir;
  document.body.dataset.lang = lang;
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('.lang-switch button').forEach(b => b.classList.toggle('is-active', b.dataset.setlang === lang));
  applySeo();
  injectMenuSchema();
  buildTabs();
  buildFilters();
  renderMenu();
  renderStatus();
  wirePickupMsgs();
  renderPicker();
  renderGallery();
}

const track = (e, p) => { if (window.lfTrack) window.lfTrack(e, p || {}); };

/* ───────────────── liens & coordonnées (INFO) ──────────── */
const PICKUP_MSG = {
  fr: 'Bonjour! Je voudrais passer une commande pour emporter.',
  en: "Hi! I'd like to place a pickup order.",
  ar: 'مرحبا! بدي اعمل طلب استلام من المحل.',
};

function waLink(msg) {
  return `https://wa.me/${INFO.whatsapp}?text=${encodeURIComponent(msg)}`;
}

function wireInfo() {
  const tel = `tel:+${INFO.phoneRaw}`;
  $('#lnkUber').href = INFO.uber;
  $('#lnkDD').href = INFO.doordash;
  $('#lnkCall2').href = tel;
  $('#osUber').href = INFO.uber;
  $('#osDD').href = INFO.doordash;
  $('#osCall').href = tel;
  $('#cAddr').textContent = INFO.address;
  $('#cMaps').href = INFO.dir;
  $('#cCall').href = tel;
  $('#cMail').href = `mailto:${INFO.email}`;
  $('#cMail').textContent = INFO.email;
  $('#lnkReview').href = INFO.review;
  $('#socIG').href = INFO.instagram;
  $('#socFB').href = INFO.facebook;
  document.addEventListener('lf-settings', (e) => {
    const st = e.detail || {};
    if (st.instagram) $('#socIG').href = st.instagram;
    if (st.facebook) $('#socFB').href = st.facebook;
    const tt = $('#socTT');
    if (tt && st.tiktok) { tt.href = st.tiktok; tt.hidden = false; }
    if (st.phone) {
      const tel2 = 'tel:' + String(st.phone).replace(/[^+0-9]/g, '');
      ['#lnkCall2', '#osCall', '#cCall'].forEach(sel => { const el = $(sel); if (el) el.href = tel2; });
    }
    if (st.address) { const a = $('#cAddr'); if (a) a.textContent = st.address; }
    if (st.email) { const m = $('#cMail'); if (m) { m.href = 'mailto:' + st.email; m.textContent = st.email; } }
    applySeo();
    renderMenu();
  });
  wirePickupMsgs();
}

function wirePickupMsgs() {
  const wa = waLink(PICKUP_MSG[lang] || PICKUP_MSG.fr);
  $('#lnkWA').href = wa;
  $('#osWA').href = wa;
}

/* ── statut ouvert/fermé en direct (heure de Montréal) ──── */
function montrealNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type) => (parts.find(p => p.type === type) || {}).value;
  const dayIdx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')];
  return { day: dayIdx, mins: parseInt(get('hour'), 10) % 24 * 60 + parseInt(get('minute'), 10) };
}

function renderStatus() {
  const badge = $('#statusBadge');
  if (!badge) return;
  const { day, mins } = montrealNow();
  const win = SCHEDULE[day];
  const open = !!win && mins >= win[0] && mins < win[1];
  badge.classList.toggle('status--open', open);
  badge.classList.toggle('status--closed', !open);
  $('#statusLabel').textContent = open ? t('statusOpen') : t('statusClosed');
}

/* ── traiteur → WhatsApp ────────────────────────────────── */
const CATERING_TPL = {
  fr: (v) => `Demande traiteur — Le Four\n\nNom : ${v.name}\nTéléphone : ${v.phone}\nDate de l'événement : ${v.date}\nNombre de personnes : ${v.guests}\n\nArticles :\n${v.items}\n\nNote :\n${v.details || DASH}`,
  en: (v) => `Catering request — Le Four\n\nName: ${v.name}\nPhone: ${v.phone}\nEvent date: ${v.date}\nGuests: ${v.guests}\n\nItems:\n${v.items}\n\nNote:\n${v.details || DASH}`,
  ar: (v) => `طلب كاترينغ — لو فور\n\nالاسم: ${v.name}\nالهاتف: ${v.phone}\nتاريخ المناسبة: ${v.date}\nعدد الأشخاص: ${v.guests}\n\nالأصناف:\n${v.items}\n\nملاحظة:\n${v.details || DASH}`,
};

/* ── sélecteur d'articles pour le traiteur ──────────────── */
const PICK = new Map();

function renderPicker() {
  const host = $('#cateringPicker');
  if (!host) return;
  host.innerHTML = CATS.map(c => `
    <div class="pick-group">
      <p class="pick-cat">${t(titleKey[c.key])}</p>
      ${MENU[c.key].map(it => {
        const q = PICK.get(it.id) || 0;
        return `<div class="pick-row${q ? ' is-on' : ''}" data-pid="${it.id}">
          <span class="pick-name">${it.name[lang]}</span>
          <span class="stepper">
            <button type="button" data-step="-1" aria-label="-">−</button>
            <b class="pick-q">${q}</b>
            <button type="button" data-step="1" aria-label="+">+</button>
          </span>
        </div>`;
      }).join('')}
    </div>`).join('');

  $$('.pick-row', host).forEach(row => {
    $$('[data-step]', row).forEach(btn => btn.addEventListener('click', () => {
      const id = row.dataset.pid;
      const next = Math.max(0, (PICK.get(id) || 0) + Number(btn.dataset.step));
      if (next) PICK.set(id, next); else PICK.delete(id);
      $('.pick-q', row).textContent = next;
      row.classList.toggle('is-on', !!next);
      updatePickSummary();
    }));
  });
  updatePickSummary();
}

function pickedList() {
  const out = [];
  for (const c of CATS) {
    for (const it of MENU[c.key]) {
      const q = PICK.get(it.id);
      if (q) out.push({ name: it.name[lang], q });
    }
  }
  return out;
}

function updatePickSummary() {
  const el = $('#pickSummary');
  if (!el) return;
  const list = pickedList();
  const total = list.reduce((n, i) => n + i.q, 0);
  el.textContent = list.length
    ? list.map(i => `${i.name} × ${i.q}`).join(' · ') + `  (${total})`
    : t('cartEmpty');
  el.classList.toggle('is-on', !!list.length);
}

function bindCatering() {
  const form = $('#cateringForm');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const v = {
      name: (fd.get('name') || '').toString().trim(),
      phone: (fd.get('phone') || '').toString().trim(),
      date: (fd.get('date') || '').toString(),
      guests: (fd.get('guests') || '').toString(),
      details: (fd.get('details') || '').toString().trim(),
      items: pickedList().map(i => JOINSAFE(i)).join(NL) || DASH,
    };
    const tpl = CATERING_TPL[lang] || CATERING_TPL.fr;
    track('catering_submit', { guests: v.guests });
    window.open(waLink(tpl(v)), '_blank', 'noopener');
  });
}


/* ── formulaire de contact -> WhatsApp ──────────────────── */
const CONTACT_TPL = {
  fr: (v) => 'Message — Le Four' + NL + NL + 'Nom : ' + v.name + NL + 'Téléphone : ' + v.phone + NL + NL + v.message,
  en: (v) => 'Message — Le Four' + NL + NL + 'Name: ' + v.name + NL + 'Phone: ' + v.phone + NL + NL + v.message,
  ar: (v) => 'رسالة — لو فور' + NL + NL + 'الاسم: ' + v.name + NL + 'الهاتف: ' + v.phone + NL + NL + v.message,
};

function bindContact() {
  const form = $('#contactForm');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const v = {
      name: (fd.get('name') || '').toString().trim(),
      phone: (fd.get('phone') || '').toString().trim(),
      message: (fd.get('message') || '').toString().trim(),
    };
    const tpl = CONTACT_TPL[lang] || CONTACT_TPL.fr;
    track('contact_submit', { form: 'contact' });
    window.open(waLink(tpl(v)), '_blank', 'noopener');
  });
}

/* ── feuille « Commander en ligne » ─────────────────────── */
function bindOrderSheet() {
  const os = $('#osheet');
  const openBtn = $('#orderOpen');
  const open = () => { os.classList.add('is-open'); os.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; };
  const close = () => { os.classList.remove('is-open'); os.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; };
  openBtn && openBtn.addEventListener('click', () => { track('order_online'); open(); });
  $$('#osheet [data-oclose]').forEach(el => el.addEventListener('click', close));
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

function setLang(l) {
  if (!UI[l]) return;
  lang = l;
  track('language_change', { language: l });
  localStorage.setItem('lefour-lang', l);
  closeSheet();
  applyI18n();
}

/* ───────────────────── tabs / filters ──────────────────── */
/* NB: la catégorie « pizzas » est masquée à la demande du client (2026-08) —
   les données restent dans data.js; remettre la ligne pour la réactiver. */
const CATS = [
  { key: 'manakish', kind: 'manakish', no: '01' },
  /* { key: 'pizzas', kind: 'pizza', no: '02' }, */
  { key: 'minis',    kind: 'mini',     no: '02' },
  { key: 'mezze',    kind: 'mezze',    no: '03' },
  { key: 'drinks',   kind: 'drink',    no: '04' },
];
const titleKey = { manakish: 'manakishTitle', pizzas: 'pizzasTitle', minis: 'minisTitle', mezze: 'mezzeTitle', drinks: 'drinksTitle' };
const subKey   = { manakish: 'manakishSub',   pizzas: 'pizzasSub',   minis: 'minisSub',   mezze: 'mezzeSub',   drinks: 'drinksSub' };

let activeFilter = null; /* null | 'veg' | 'spicy' | 'sweet' */

function buildTabs() {
  $('#tabs').innerHTML = CATS.map((c, i) => `
    <button class="tab ${i === 0 ? 'is-active' : ''}" data-tab="${c.key}">
      ${t(titleKey[c.key])} <small>${MENU[c.key].length}</small>
    </button>`).join('');
  $$('.tab').forEach(tab => tab.addEventListener('click', () => {
    const target = $('#' + tab.dataset.tab);
    if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }));
}

function buildFilters() {
  const tags = ['veg', 'spicy', 'sweet'];
  $('#filters').innerHTML =
    `<button class="chip ${!activeFilter ? 'is-on' : ''}" data-filter="">${FILTER_ALL[lang]}</button>` +
    tags.map(tg => `<button class="chip ${activeFilter === tg ? 'is-on' : ''}" data-filter="${tg}">${t(tg)}</button>`).join('');
  $$('#filters .chip').forEach(chip => chip.addEventListener('click', () => {
    activeFilter = chip.dataset.filter || null;
    $$('#filters .chip').forEach(c => c.classList.toggle('is-on', (c.dataset.filter || null) === activeFilter));
    applyFilter();
  }));
}

function applyFilter() {
  $$('.card').forEach(card => {
    const tags = (card.dataset.tags || '').split(',');
    card.classList.toggle('is-hidden', !!activeFilter && !tags.includes(activeFilter));
  });
  /* hide categories left empty */
  $$('.cat').forEach(cat => {
    const any = $$('.card:not(.is-hidden)', cat).length > 0;
    cat.style.display = any ? '' : 'none';
  });
}

/* ───────────────────── menu render ─────────────────────── */
function sizeCount(item, kind) {
  if (kind === 'mini') return 0;
  let n = 0;
  if (item.large != null) n++;
  if (item.box != null) n++;
  return n;
}

function renderMenu() {
  $('#menu').innerHTML = CATS.map(c => `
    <section class="cat" id="${c.key}" data-key="${c.key}">
      <header class="cat-head">
        <span class="cat-no">${c.no}</span>
        <h2 class="cat-title">${t(titleKey[c.key])}</h2>
        <p class="cat-sub">${t(subKey[c.key])}</p>
      </header>
      <div class="cards">
        ${MENU[c.key].map(item => {
          const extra = sizeCount(item, c.kind);
          return `
          <button type="button" class="card" data-kind="${c.kind}" data-cat="${c.key}" data-id="${item.id}" data-tags="${(item.tags || []).join(',')}">
            <span class="card-art${PHOTOS.dishes[item.id] ? ' card-art--photo' : ''}">${PHOTOS.dishes[item.id] ? `<img src="${PHOTOS.dishes[item.id]}" alt="${altFor('dish:' + item.id, item.name[lang] + ' — Boulangerie Le Four')}" loading="lazy">` : inkArt(item, c.kind)}</span>
            <span class="card-mid">
              <span class="card-name">${item.name[lang]}</span>
              <span class="card-desc">${item.desc[lang] || ''}</span>
              ${item.tags && item.tags.length ? `<span class="card-tags">${item.tags.map(tg => t(tg)).join(' · ')}</span>` : ''}
            </span>
            <span class="card-end">
              ${item.price != null ? `<span class="card-price">${fmtPrice(item.price)}${c.kind === 'mini' ? ' <small>/12</small>' : ''}</span>` : ''}
              ${extra ? `<span class="card-sizes">+${extra} ${SIZES_HINT[lang][extra > 1 ? 1 : 0]}</span>` : ''}
            </span>
          </button>`;
        }).join('')}
      </div>
    </section>`).join('');

  $$('.card').forEach(card => {
    const item = MENU[card.dataset.cat].find(i => i.id === card.dataset.id);
    card.addEventListener('click', () => openSheet(item, card.dataset.kind));
  });
  applyFilter();
  trackTabs();
}

/* scroll-spy for tabs */
let tabObs = null;
function trackTabs() {
  if (tabObs) tabObs.disconnect();
  const tabs = $$('.tab');
  tabObs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        tabs.forEach(tb => {
          const on = tb.dataset.tab === en.target.dataset.key;
          tb.classList.toggle('is-active', on);
          if (on) tb.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
        });
      }
    });
  }, { rootMargin: '-15% 0px -70% 0px' });
  $$('.cat').forEach(c => tabObs.observe(c));
}

/* ───────────────────── bottom sheet ────────────────────── */
const sheet = $('#sheet');
const sheetCard = $('#sheetCard');
let lastFocus = null;

function openSheet(item, kind) {
  lastFocus = document.activeElement;
  track('view_item', { item_name: (item.name && item.name.en) || item.id, item_id: item.id, item_category: kind });
  const photo = PHOTOS.dishes[item.id];
  const pf = $('#sheetPhoto');
  if (photo) { $('#sheetPhotoImg').src = photo;
    $('#sheetPhotoImg').alt = altFor('dish:' + item.id, item.name[lang] + ' — Boulangerie Le Four'); pf.hidden = false; $('#sheetArt').hidden = true; }
  else { pf.hidden = true; $('#sheetArt').hidden = false; }
  $('#sheetArt').innerHTML = inkArt(item, kind);
  $('#sheetName').textContent = item.name[lang];
  $('#sheetDesc').textContent = item.desc[lang] || '';
  const tagsEl = $('#sheetTags');
  tagsEl.textContent = (item.tags || []).map(tg => t(tg)).join(' · ');
  tagsEl.style.display = (item.tags && item.tags.length) ? '' : 'none';
  const rows = [];
  if (kind === 'mini') rows.push([`12 · ${t('per12')}`, item.price]);
  else {
    if (item.price != null) rows.push([t('sizeR'), item.price]);
    if (item.large != null) rows.push([t('sizeL'), item.large]);
    if (item.box != null) rows.push([t('sizeB'), item.box]);
  }
  $('#sheetPrices').innerHTML = rows.map(([l, p]) =>
    `<div class="price-row"><span>${l}</span><i class="pr-leader" aria-hidden="true"></i><b>${fmtPrice(p)}</b></div>`).join('');
  $('#sheetPrices').style.display = rows.length ? '' : 'none';
  sheet.classList.add('is-open');
  sheet.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  if (!sheet.classList.contains('is-open')) return;
  sheet.classList.remove('is-open');
  sheet.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  sheetCard.style.transform = '';
  lastFocus && lastFocus.focus && lastFocus.focus();
}

/* swipe-down to close */
(function sheetDrag() {
  let startY = 0, dy = 0, dragging = false;
  const grab = $('#sheetGrab');
  const start = (y) => { dragging = true; startY = y; dy = 0; sheet.classList.add('is-dragging'); };
  const move = (y) => {
    if (!dragging) return;
    dy = Math.max(0, y - startY);
    sheetCard.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('is-dragging');
    if (dy > 90) closeSheet();
    else sheetCard.style.transform = '';
  };
  grab.addEventListener('pointerdown', e => { grab.setPointerCapture(e.pointerId); start(e.clientY); });
  grab.addEventListener('pointermove', e => move(e.clientY));
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
})();

/* ───────────────────── story toggle ────────────────────── */
function bindStory() {
  const btn = $('#storyToggle'), body = $('#storyBody');
  btn.addEventListener('click', () => {
    const open = body.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(open));
  });
}

/* ───────────────────── init ────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  wireInfo();
  applyI18n();
  bindStory();
  bindCatering();
  bindContact();
  bindOrderSheet();
  loadPhotos();
  setInterval(renderStatus, 60000);
  $$('[data-setlang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.setlang)));
  $$('#sheet [data-close]').forEach(el => el.addEventListener('click', closeSheet));
  addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
});

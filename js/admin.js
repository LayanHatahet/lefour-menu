/* Photo dashboard — Le Four
   Resizes images in the browser, then sends them to /api/upload. */
'use strict';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

const CATS = [
  { key: 'manakish', label: 'Manakish' },
  { key: 'pizzas',   label: 'Pizzas (hidden on the site)' },
  { key: 'minis',    label: 'Bites' },
  { key: 'mezze',    label: 'Mezze' },
  { key: 'drinks',   label: 'Drinks' },
];

let KEY = sessionStorage.getItem('lefour-admin') || '';
let DATA = { dishes: {}, gallery: [], configured: true };

const toast = (msg) => {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2600);
};

/* ── redimensionnement client (max 1400px, JPEG 0.82) ───── */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('lecture impossible'));
    fr.onload = () => { img.src = fr.result; };
    img.onerror = () => reject(new Error('image invalide'));
    img.onload = () => {
      const MAX = 1400;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#F4ECDF'; cx.fillRect(0, 0, w, h);
      cx.drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', 0.82));
    };
    fr.readAsDataURL(file);
  });
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-admin-key': KEY, ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.blocked) storagePaused();
    throw new Error(j.error || `HTTP ${r.status}`);
  }
  return j;
}

/* Vercel has paused the photo storage (free-plan monthly limit). Say so in
   plain words, and grey out uploads and saving until it is back. */
function storagePaused() {
  const note = $('#notice');
  if (note) {
    note.hidden = false;
    note.innerHTML = "<b>Photo storage is paused.</b> Vercel's free plan reached its monthly limit, so photos and saved settings cannot be shown or changed right now. <b>Nothing has been deleted.</b> Please don't upload or save until this message is gone.";
  }
  document.body.classList.add('is-paused');
}

async function load() {
  DATA = await api('/api/photos?fresh=' + Date.now());
  const note = $('#notice');
  if (DATA.configured === false) {
    note.hidden = false;
    note.innerHTML = "Photo storage is not set up yet. In Vercel: <b>Storage → Create Database → Blob</b>, connect it to the <code>lefour</code> project, then redeploy. (The <code>BLOB_READ_WRITE_TOKEN</code> variable is added automatically.)";
  } else {
    note.hidden = true;
  }
  document.body.classList.remove('is-paused');
  renderHero();
  renderGallery();
  renderDishes();
  /* an upload reloads the photo lists; edits not saved yet (a position just
     set, a half-typed title) must survive that, so settings are re-read only
     when nothing is pending */
  if (!DIRTY || !SETTINGS) await loadSettings();
  else renderAlts();
  applyAdminPositions();
}


/* ── home page hero photo ───────────────────────────────── */
function renderHero() {
  const url = DATA.hero || '';
  const thumb = $('#heroThumb'), del = $('#heroDel'), label = $('#heroLabel');
  if (!thumb) return;
  thumb.innerHTML = url ? `<img src="${url}" alt="" loading="lazy" data-photo="${url}">` : 'none';
  del.hidden = !url;
  const adj = $('#heroAdj');
  if (adj) { adj.hidden = !url; adj.dataset.adj = url; }
  label.firstChild.textContent = url ? 'Replace' : 'Add';
}

/* ── gallery ────────────────────────────────────────────── */
function renderGallery() {
  $('#galList').innerHTML = DATA.gallery.map(u => `
    <figure><img src="${u}" alt="" loading="lazy" data-photo="${u}"><button data-del="${u}" title="Delete">✕</button><button class="gpos" data-adj="${u}" data-kind="gallery" data-name="Gallery photo">Position</button></figure>
  `).join('') || '<p class="muted">No photos yet.</p>';
  $$('#galList [data-del]').forEach(b => b.addEventListener('click', () => removePhoto(b.dataset.del)));
}

/* ── dishes ─────────────────────────────────────────────── */
function renderDishes() {
  const host = $('#dishList');
  host.innerHTML = CATS.map(c => {
    const items = (MENU[c.key] || []);
    if (!items.length) return '';
    return `<p class="cat-h">${c.label}</p>` + items.map(it => {
      const url = DATA.dishes[it.id];
      return `<div class="row" data-id="${it.id}">
        <span class="thumb">${url ? `<img src="${url}" alt="" loading="lazy" data-photo="${url}">` : 'none'}</span>
        <span class="rname">${it.name.en}<small>${it.id}</small></span>
        <span class="ract">
          ${url ? `<button class="adj" data-adj="${url}" data-kind="dish" data-name="${String(it.name.en).replace(/"/g, '&quot;')}">Position</button>` : ''}
          <label>${url ? 'Replace' : 'Add'}<input type="file" accept="image/*" hidden data-dish="${it.id}"></label>
          ${url ? `<button class="del" data-deldish="${url}">Remove</button>` : ''}
        </span>
      </div>`;
    }).join('');
  }).join('');

  $$('#dishList [data-dish]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (f) await uploadPhoto('dish', f, inp.dataset.dish);
      inp.value = '';
    });
  });
  $$('#dishList [data-deldish]').forEach(b =>
    b.addEventListener('click', () => removePhoto(b.dataset.deldish)));
}

/* ── actions ────────────────────────────────────────────── */
async function uploadPhoto(kind, file, id) {
  const app = $('#app');
  app.classList.add('busy');
  try {
    toast('Processing image…');
    const dataUrl = await shrink(file);
    await api('/api/upload', { method: 'POST', body: JSON.stringify({ kind, id, dataUrl }) });
    toast('Photo saved ✓');
    await load();
  } catch (e) {
    toast('Error: ' + e.message);
  } finally {
    app.classList.remove('busy');
  }
}

async function removePhoto(url) {
  if (!confirm('Delete this photo?')) return;
  const app = $('#app');
  app.classList.add('busy');
  try {
    await api('/api/photos', { method: 'POST', body: JSON.stringify({ action: 'delete', urls: [url] }) });
    toast('Photo deleted');
    await load();
  } catch (e) {
    toast('Error: ' + e.message);
  } finally {
    app.classList.remove('busy');
  }
}


/* ── settings: SEO, analytics, business, social ─────────── */
let SETTINGS = null;
let DIRTY = false;

const TRACKED_EVENTS = [
  ['view_menu', 'View Menu button'],
  ['order_online', 'Order Online button'],
  ['uber_eats_click', 'Uber Eats'],
  ['doordash_click', 'DoorDash'],
  ['whatsapp_click', 'WhatsApp'],
  ['call_click', 'Call'],
  ['directions_click', 'Directions'],
  ['catering_submit', 'Catering inquiry sent'],
  ['view_item', 'Dish opened'],
  ['review_click', 'Google review'],
  ['social_instagram', 'Instagram'],
  ['social_facebook', 'Facebook'],
  ['social_tiktok', 'TikTok'],
  ['language_change', 'Language switch'],
];

/* "alt.gallery:https://….jpg": only the FIRST dot separates the group from
   the key. Photo URLs carry dots of their own, and splitting on all of them
   saved gallery alt text under nested keys the site never read. */
function splitPath(path) {
  const i = path.indexOf('.');
  return i < 0 ? [path] : [path.slice(0, i), path.slice(i + 1)];
}
function getPath(obj, path) {
  return splitPath(path).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, val) {
  const keys = splitPath(path);
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = val;
}

function markDirty() {
  DIRTY = true;
  const bar = $('#saveBar');
  if (bar) { bar.hidden = false; $('#saveHint').textContent = 'Unsaved changes'; }
}

function fillSettingsForm() {
  $$('[data-set]').forEach(el => {
    const v = getPath(SETTINGS, el.dataset.set);
    el.value = (v == null ? '' : v);
    updateCount(el);
    el.addEventListener('input', () => { setPath(SETTINGS, el.dataset.set, el.value); updateCount(el); markDirty(); });
  });
  const ev = $('#evList');
  if (ev) ev.innerHTML = TRACKED_EVENTS.map(([k, label]) =>
    `<div class="ev"><code>${k}</code><span>${label}</span></div>`).join('');
}

function updateCount(el) {
  const c = el.parentElement && el.parentElement.querySelector('.count');
  if (!c || !el.maxLength || el.maxLength < 0) return;
  const n = (el.value || '').length;
  c.textContent = n + ' / ' + el.maxLength;
  c.classList.toggle('warn', n > el.maxLength - 10);
}

function renderAlts() {
  const host = $('#altList');
  if (!host) return;
  const rows = [];
  CATS.forEach(c => (MENU[c.key] || []).forEach(it => {
    if (!DATA.dishes[it.id]) return;
    rows.push(`<div class="row"><span class="thumb"><img src="${DATA.dishes[it.id]}" alt="" loading="lazy" data-photo="${DATA.dishes[it.id]}"></span>
      <span class="rname">${it.name.en}<small>${it.id}</small></span>
      <input class="altin" data-set="alt.dish:${it.id}" placeholder="Describe this photo…"></div>`);
  }));
  DATA.gallery.forEach((u, i) => {
    rows.push(`<div class="row"><span class="thumb"><img src="${u}" alt="" loading="lazy" data-photo="${u}"></span>
      <span class="rname">Gallery photo ${i + 1}</span>
      <input class="altin" data-set="alt.gallery:${u}" placeholder="Describe this photo…"></div>`);
  });
  host.innerHTML = rows.join('') || '<p class="muted">Upload photos first — then you can describe them here.</p>';
  $$('#altList [data-set]').forEach(el => {
    const v = getPath(SETTINGS, el.dataset.set);
    el.value = (v == null ? '' : v);
    el.addEventListener('input', () => { setPath(SETTINGS, el.dataset.set, el.value); markDirty(); });
  });
  applyAdminPositions();
}

/* ── menu & prices ───────────────────────────────────────
   The menu itself lives in data.js and ships with the site. Here the owner
   only overrides it: an empty box means "use what the site ships with", so
   SETTINGS.menu stays small and a dish can always be put back. Dishes are
   never added or removed from the dashboard — the site's artwork, slugs and
   structured data are keyed to the ids in data.js. */
const MENU_SIZE_FIELDS = [
  ['price', 'Regular'],
  ['large', 'Sandwich'],
  ['box', 'Box of 6'],
];
const MENU_LANGS = [['fr', 'French'], ['en', 'English'], ['ar', 'Arabic']];
const PRICE_RE = /^\d{1,4}([.,]\d{1,2})?$/;
/* 0 is not a price. Someone typing 0 means "we do not sell this size", which
   is what an empty box already says, so 0 is refused rather than published. */
const priceBad = (typed) => typed !== '' && (!PRICE_RE.test(typed) || Number(typed.replace(',', '.')) <= 0);

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function menuBaseOf(id) {
  for (const c of CATS) {
    const hit = (MENU[c.key] || []).find(it => it.id === id);
    if (hit) return hit;
  }
  return null;
}

/* the override bag for one dish, created only when something is typed */
function menuOv(id, create) {
  if (!SETTINGS.menu || typeof SETTINGS.menu !== 'object') SETTINGS.menu = {};
  if (!SETTINGS.menu[id] && create) SETTINGS.menu[id] = {};
  return SETTINGS.menu[id] || {};
}

/* an override that no longer holds anything is removed, so "emptied every
   box" is stored as "nothing changed" instead of as a pile of empty strings */
function pruneMenuOv(id) {
  const o = SETTINGS.menu && SETTINGS.menu[id];
  if (!o) return;
  for (const k of ['name', 'desc']) {
    if (o[k] && !Object.keys(o[k]).length) delete o[k];
  }
  if (!Object.keys(o).length) delete SETTINGS.menu[id];
}

function priceBoxValue(id, key) {
  const o = menuOv(id);
  return o[key] == null ? '' : String(o[key]);
}

/* the summary line shows the price the site will actually display */
function menuSummary(it) {
  const ov = menuOv(it.id);
  const parts = MENU_SIZE_FIELDS
    .filter(([k]) => it[k] != null || ov[k] != null)
    .map(([k, label]) => label + ' ' + (ov[k] != null ? ov[k] : it[k]) + ' $');
  return parts.join(' · ') || '—';
}

function menuChangedLabel(id) {
  const o = SETTINGS.menu && SETTINGS.menu[id];
  return o && Object.keys(o).length ? 'Edited' : '';
}

function isSoldOut(id) {
  const o = SETTINGS.menu && SETTINGS.menu[id];
  return !!(o && o.off);
}

/* L interrupteur de rupture ne passe PAS par « Save changes » : pendant le
   service on veut un geste, pas un formulaire, et surtout on ne veut pas
   publier au passage des prix a moitie saisis. /api/stock ne touche que ce
   champ-la, sur la version enregistree. */
async function setSoldOut(id, off) {
  const btn = $('[data-mstock="' + id + '"]');
  if (btn) btn.disabled = true;
  try {
    await api('/api/stock', { method: 'POST', body: JSON.stringify({ id: id, off: off }) });
    const bag = menuOv(id, true);
    if (off) bag.off = true; else delete bag.off;
    pruneMenuOv(id);
    refreshMenuRow(id);
    toast(off ? 'Marked sold out - live on the site' : 'Back on sale - live on the site');
  } catch (e) {
    toast('Error: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function refreshMenuRow(id) {
  const it = menuBaseOf(id);
  if (!it) return;
  const sum = $('[data-msum="' + id + '"]');
  if (sum) sum.textContent = menuSummary(it);
  const ch = $('[data-mchanged="' + id + '"]');
  if (ch) ch.textContent = menuChangedLabel(id);
  const row = $('[data-mitem="' + id + '"]');
  if (row) row.classList.toggle('is-edited', !!menuChangedLabel(id));
  const out = isSoldOut(id);
  const btn = $('[data-mstock="' + id + '"]');
  if (btn) {
    btn.classList.toggle('is-out', out);
    btn.textContent = out ? 'Sold out' : 'On sale';
    btn.setAttribute('aria-pressed', String(out));
    btn.title = out ? 'Click to put it back on sale' : 'Click to mark it sold out';
  }
  if (row) row.classList.toggle('is-out', out);
}

function menuRowHtml(it) {
  const ov = menuOv(it.id);
  const photo = DATA.dishes[it.id];
  /* every size box is always shown, even when the site ships no price for it:
     that is how a brand-new dish, or the drinks, get their first price without
     a code change. A box left empty means the size is simply not offered. */
  const prices = MENU_SIZE_FIELDS
    .map(([k, label]) =>
      '<label class="mprice"><span>' + label + '</span>' +
      '<input class="mp" inputmode="decimal" data-menu-price="' + it.id + '" data-key="' + k + '"' +
      ' placeholder="' + (it[k] == null ? '—' : it[k]) + '"' +
      ' value="' + esc(priceBoxValue(it.id, k)) + '"></label>').join('');

  const texts = MENU_LANGS.map(([lg, label]) =>
    '<label class="fld"><span>Name — ' + label + '</span>' +
    '<input data-menu-text="' + it.id + '" data-key="name" data-lang="' + lg + '" maxlength="80"' +
    (lg === 'ar' ? ' dir="rtl"' : '') +
    ' placeholder="' + esc(it.name[lg] || '') + '"' +
    ' value="' + esc((ov.name && ov.name[lg]) || '') + '"></label>' +
    '<label class="fld"><span>Description — ' + label + '</span>' +
    '<textarea data-menu-text="' + it.id + '" data-key="desc" data-lang="' + lg + '" rows="2" maxlength="600"' +
    (lg === 'ar' ? ' dir="rtl"' : '') +
    ' placeholder="' + esc(it.desc[lg] || '') + '">' +
    esc((ov.desc && ov.desc[lg]) || '') + '</textarea></label>').join('');

  return '<details class="mitem" data-mitem="' + it.id + '">' +
    '<summary><span class="thumb">' +
      (photo ? '<img src="' + photo + '" alt="" loading="lazy" data-photo="' + photo + '">' : '<i class="mnopic"></i>') +
    '</span>' +
    '<span class="rname">' + esc(it.name.en) + '<small>' + it.id + '</small></span>' +
    '<span class="msum" data-msum="' + it.id + '"></span>' +
    '<span class="mflag" data-mchanged="' + it.id + '"></span>' +
    '<button type="button" class="mstock" data-mstock="' + it.id + '" aria-pressed="false">On sale</button>' +
    '</summary>' +
    '<div class="mbody">' +
      '<div class="mprices">' + prices + '</div>' +
      '<div class="grid2">' + texts + '</div>' +
      '<label class="fld mtax"><span>Taxes (TPS 5% + TVQ 9.975%)</span>' +
        '<select data-menu-tax="' + it.id + '">' +
          '<option value=""' + (ov.tax ? '' : ' selected') + '>Automatic - taxed unless sold by 6 or 12</option>' +
          '<option value="on"' + (ov.tax === 'on' ? ' selected' : '') + '>Always taxed</option>' +
          '<option value="off"' + (ov.tax === 'off' ? ' selected' : '') + '>Never taxed</option>' +
        '</select></label>' +
      '<div class="mfoot"><button type="button" class="mreset" data-mreset="' + it.id + '">Reset this dish</button>' +
      '<span class="muted">Empty box = the original text or price shown in grey.</span></div>' +
    '</div></details>';
}

function renderMenuEditor() {
  const host = $('#menuList');
  if (!host || !SETTINGS) return;
  host.innerHTML = CATS.map(c => {
    const items = MENU[c.key] || [];
    if (!items.length) return '';
    return '<div class="mcat"><h3>' + c.label + '</h3>' + items.map(menuRowHtml).join('') + '</div>';
  }).join('');

  $$('#menuList [data-menu-price]').forEach(el => el.addEventListener('input', () => {
    const id = el.dataset.menuPrice, key = el.dataset.key;
    const typed = el.value.trim();
    const bad = priceBad(typed);
    el.classList.toggle('err', bad);
    markDirty();
    if (bad) return;
    if (typed === '') delete menuOv(id, true)[key];
    else menuOv(id, true)[key] = Number(typed.replace(',', '.'));
    pruneMenuOv(id);
    refreshMenuRow(id);
  }));

  $$('#menuList [data-menu-text]').forEach(el => el.addEventListener('input', () => {
    const id = el.dataset.menuText, key = el.dataset.key, lg = el.dataset.lang;
    const bag = menuOv(id, true);
    if (!bag[key] || typeof bag[key] !== 'object') bag[key] = {};
    if (el.value.trim()) bag[key][lg] = el.value;
    else delete bag[key][lg];
    pruneMenuOv(id);
    refreshMenuRow(id);
    markDirty();
  }));

  $$('#menuList [data-mstock]').forEach(b => b.addEventListener('click', (e) => {
    /* le bouton vit dans un <summary> : sans ceci, le clic plierait la ligne */
    e.preventDefault();
    e.stopPropagation();
    setSoldOut(b.dataset.mstock, !isSoldOut(b.dataset.mstock));
  }));

  $$('#menuList [data-menu-tax]').forEach(el => el.addEventListener('change', () => {
    const id = el.dataset.menuTax;
    const bag = menuOv(id, true);
    if (el.value === 'on' || el.value === 'off') bag.tax = el.value;
    else delete bag.tax;
    pruneMenuOv(id);
    refreshMenuRow(id);
    markDirty();
  }));

  $$('#menuList [data-mreset]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.mreset;
    if (SETTINGS.menu) delete SETTINGS.menu[id];
    const was = $('[data-mitem="' + id + '"]');
    const open = !!(was && was.open);
    renderMenuEditor();
    const now = $('[data-mitem="' + id + '"]');
    if (now && open) now.open = true;
    markDirty();
    toast('Reset — click Save changes to publish it');
  }));

  CATS.forEach(c => (MENU[c.key] || []).forEach(it => refreshMenuRow(it.id)));
  applyAdminPositions();
}

/* a bad price must never reach the site: same rule as the API */
function validateMenu() {
  let ok = true;
  $$('#menuList [data-menu-price]').forEach(el => {
    const typed = el.value.trim();
    const bad = priceBad(typed);
    el.classList.toggle('err', bad);
    if (bad) ok = false;
  });
  return ok;
}

/* ── opening hours ───────────────────────────────────────
   Stored as one string per weekday, "HH:MM-HH:MM", or "" for closed.
   Key 0 is Sunday, matching SCHEDULE in data.js and JavaScript's getDay(). */
const HOUR_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOUR_RE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

function parseWin(v) {
  const m = HOUR_RE.exec(String(v || '').trim());
  return m ? [m[1] + ':' + m[2], m[3] + ':' + m[4]] : ['', ''];
}

/* Nothing saved yet? Show the schedule the site is actually running on
   (SCHEDULE in data.js) instead of seven "Closed" rows the owner might
   save by accident. Editing any row is what first writes the setting. */
function seedHoursFromSite() {
  const pad = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  const out = {};
  for (let d = 0; d < 7; d++) {
    const w = (typeof SCHEDULE !== 'undefined' && SCHEDULE[d]) || null;
    out[d] = w ? pad(w[0]) + '-' + pad(w[1]) : '';
  }
  return out;
}

function renderHoursEditor() {
  const host = $('#hoursEditor');
  if (!host) return;
  if (!SETTINGS.hours || typeof SETTINGS.hours !== 'object') SETTINGS.hours = {};
  const anySaved = Object.keys(SETTINGS.hours).some(k => String(SETTINGS.hours[k] || '').trim());
  if (!anySaved) SETTINGS.hours = seedHoursFromSite();
  host.innerHTML = HOUR_ORDER.map(d => {
    const [o, c] = parseWin(SETTINGS.hours[d]);
    const closed = !o;
    return `<div class="hrow${closed ? ' is-closed' : ''}" data-day="${d}">
      <span class="hday">${HOUR_DAYS[d]}</span>
      <input type="time" data-open value="${o || '06:30'}"${closed ? ' disabled' : ''}>
      <span class="hdash">to</span>
      <input type="time" data-close value="${c || '17:00'}"${closed ? ' disabled' : ''}>
      <label class="hclosed"><input type="checkbox" data-closed${closed ? ' checked' : ''}> Closed</label>
    </div>`;
  }).join('');
  $$('#hoursEditor .hrow').forEach(row => {
    row.querySelectorAll('input').forEach(i =>
      i.addEventListener('change', () => commitHours(row)));
  });
  validateHours();
}

function commitHours(row) {
  const d = row.dataset.day;
  const closed = row.querySelector('[data-closed]').checked;
  const o = row.querySelector('[data-open]');
  const c = row.querySelector('[data-close]');
  o.disabled = c.disabled = closed;
  row.classList.toggle('is-closed', closed);
  SETTINGS.hours[d] = closed ? '' : `${o.value}-${c.value}`;
  validateHours();
  markDirty();
}

/* A closing time at or before the opening time would make the site read as
   closed all day, so the save button is held until it is fixed. */
function validateHours() {
  const bad = [];
  $$('#hoursEditor .hrow').forEach(row => {
    const closed = row.querySelector('[data-closed]').checked;
    const o = row.querySelector('[data-open]').value;
    const c = row.querySelector('[data-close]').value;
    const wrong = !closed && !(o < c);
    row.classList.toggle('is-bad', wrong);
    if (wrong) bad.push(HOUR_DAYS[row.dataset.day]);
  });
  const err = $('#hoursErr');
  if (err) {
    err.textContent = bad.length
      ? 'Closing time must be later than opening time: ' + bad.join(', ')
      : '';
    err.hidden = !bad.length;
  }
  const btn = $('#saveBtn');
  if (btn) btn.disabled = bad.length > 0;
  return !bad.length;
}

async function loadSettings() {
  const j = await api('/api/settings?fresh=' + Date.now());
  SETTINGS = j.settings || {};
  if (!SETTINGS.pos || typeof SETTINGS.pos !== 'object') SETTINGS.pos = {};
  fillSettingsForm();
  renderAlts();
  renderHoursEditor();
  renderMenuEditor();
}

async function saveSettings() {
  /* settings that could not be read must never be saved: that would replace
     everything the owner saved before with empty fields */
  if (!SETTINGS) { toast('Settings could not be loaded, so nothing was saved'); return; }
  /* checked before the button is touched, so the guard survives the finally */
  if (!validateHours()) { toast('Fix the opening hours first'); return; }
  if (!validateMenu()) { toast('Fix the highlighted prices first'); return; }
  const btn = $('#saveBtn');
  btn.disabled = true;
  $('#saveHint').textContent = 'Saving…';
  try {
    prunePositions();
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ settings: SETTINGS }) });
    DIRTY = false;
    $('#saveHint').textContent = 'Saved ✓';
    toast('Settings saved ✓');
    setTimeout(() => { if (!DIRTY) $('#saveBar').hidden = true; }, 1600);
  } catch (e) {
    $('#saveHint').textContent = 'Error';
    toast('Error: ' + e.message);
  } finally { btn.disabled = false; }
}


/* ══════════ COMMANDES ═══════════════════════════════════════════════
   Les commandes ne font pas partie des « reglages » : on ne les modifie
   pas, on les consulte. Elles ont donc leur propre appel, leur propre
   onglet, et rien ici ne touche a DIRTY ni a « Save changes ».         */

let ORD_MONTH = '';
let ORD_DATA = null;
let ORD_DAY = '';

const ORD_MONTHS_FR = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function money(n) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return v.toFixed(2).replace('.', ',') + ' $';
}

function thisMonth() {
  /* le mois de Montreal, pas celui du navigateur de qui regarde */
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const g = {};
  for (const x of p) g[x.type] = x.value;
  return g.year + '-' + g.month;
}

function monthLabel(m) {
  const bits = String(m).split('-');
  return (ORD_MONTHS_FR[Number(bits[1]) - 1] || m) + ' ' + bits[0];
}

async function loadOrderMonths() {
  const sel = $('#ordMonth');
  if (!sel) return;
  let months = [];
  try {
    const j = await api('/api/orders');
    months = Array.isArray(j.months) ? j.months : [];
  } catch (e) { /* un index vide n est pas une panne : il n y a rien encore */ }
  const now = thisMonth();
  if (months.indexOf(now) === -1) months.unshift(now);
  sel.innerHTML = months.map(m =>
    '<option value="' + m + '">' + esc(monthLabel(m)) + '</option>').join('');
  ORD_MONTH = ORD_MONTH && months.indexOf(ORD_MONTH) > -1 ? ORD_MONTH : months[0];
  sel.value = ORD_MONTH;
}

async function loadOrders(month) {
  const list = $('#ordList');
  if (!list) return;
  ORD_MONTH = month;
  ORD_DAY = '';
  list.innerHTML = '<p class="muted">Loading…</p>';
  $('#ordCal').innerHTML = '';
  $('#ordStats').innerHTML = '';
  try {
    ORD_DATA = await api('/api/orders?month=' + encodeURIComponent(month));
  } catch (e) {
    ORD_DATA = null;
    list.innerHTML = '<p class="muted">Could not load orders: ' + esc(e.message) + '</p>';
    return;
  }
  renderOrders();
}

function renderOrderStats() {
  const t = (ORD_DATA && ORD_DATA.totals) || { count: 0, subtotal: 0, tps: 0, tvq: 0, total: 0 };
  $('#ordStats').innerHTML =
    '<div class="ostat"><b>' + t.count + '</b><span>orders</span></div>' +
    '<div class="ostat"><b>' + money(t.subtotal) + '</b><span>before tax</span></div>' +
    '<div class="ostat"><b>' + money(t.tps) + '</b><span>TPS collected</span></div>' +
    '<div class="ostat"><b>' + money(t.tvq) + '</b><span>TVQ collected</span></div>' +
    '<div class="ostat ostat--big"><b>' + money(t.total) + '</b><span>taken in</span></div>';
}

/* Le calendrier : une case par jour du mois, les jours vides restent
   visibles pour qu on lise le rythme de la semaine d un coup d oeil. */
function renderOrderCal() {
  const host = $('#ordCal');
  if (!host || !ORD_DATA) return;
  const bits = ORD_MONTH.split('-');
  const y = Number(bits[0]), m = Number(bits[1]);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  /* getUTCDay : 0 = dimanche. La semaine commence lundi dans un commerce. */
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const byDay = ORD_DATA.days || {};

  let cells = '';
  for (let i = 0; i < first; i++) cells += '<i class="ocell ocell--pad"></i>';
  for (let d = 1; d <= days; d++) {
    const key = ORD_MONTH + '-' + String(d).padStart(2, '0');
    const info = byDay[key];
    cells += '<button type="button" class="ocell' + (info ? ' has' : '') +
      (ORD_DAY === key ? ' is-on' : '') + '" data-oday="' + key + '"' +
      (info ? '' : ' disabled') + '>' +
      '<i>' + d + '</i>' +
      (info ? '<b>' + info.count + '</b><em>' + money(info.total) + '</em>' : '') +
      '</button>';
  }

  host.innerHTML =
    '<div class="ocal-head"><span>Mon</span><span>Tue</span><span>Wed</span>' +
    '<span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>' +
    '<div class="ocal-grid">' + cells + '</div>';

  $$('#ordCal [data-oday]').forEach(b => b.addEventListener('click', () => {
    ORD_DAY = ORD_DAY === b.dataset.oday ? '' : b.dataset.oday;
    renderOrders();
  }));
}

function orderCard(o) {
  const items = (o.items || []).map(i =>
    '<li>' + i.qty + ' &times; ' + esc(i.name) +
    '<span>' + money(i.total) + '</span></li>').join('');
  const tax = (Number(o.tps) || 0) + (Number(o.tvq) || 0);
  return '<article class="ocard">' +
    '<header><span class="owhen">' + esc(o.day) + ' · ' + esc(o.time || '') + '</span>' +
    '<span class="oref">' + esc(o.ref || '') + '</span>' +
    (o.mode === 'test' ? '<span class="otest">test</span>' : '') + '</header>' +
    '<div class="owho">' +
      '<b>' + esc(o.name || '—') + '</b>' +
      (o.phone ? '<a href="tel:' + esc(o.phone) + '">' + esc(o.phone) + '</a>' : '') +
      (o.email ? '<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + '</a>' : '') +
      (o.receipt ? '<span class="otag">receipt sent</span>' : '') +
    '</div>' +
    '<ul class="oitems">' + items + '</ul>' +
    (o.note ? '<p class="onote">“' + esc(o.note) + '”</p>' : '') +
    '<footer>' +
      (tax > 0 ? '<span>TPS ' + money(o.tps) + ' · TVQ ' + money(o.tvq) + '</span>' : '<span>no tax</span>') +
      '<b>' + money(o.total) + '</b>' +
    '</footer></article>';
}

function renderOrders() {
  if (!ORD_DATA) return;
  renderOrderStats();
  renderOrderCal();
  const all = ORD_DATA.orders || [];
  const shown = ORD_DAY ? all.filter(o => o.day === ORD_DAY) : all;
  const note = $('#ordFilter');
  if (note) {
    note.hidden = !ORD_DAY;
    note.innerHTML = ORD_DAY
      ? 'Showing ' + shown.length + ' order' + (shown.length === 1 ? '' : 's') +
        ' from ' + esc(ORD_DAY) + ' — <button type="button" class="linkish" id="ordAll">show the whole month</button>'
      : '';
    const back = $('#ordAll');
    if (back) back.addEventListener('click', () => { ORD_DAY = ''; renderOrders(); });
  }
  $('#ordList').innerHTML = shown.length
    ? shown.slice().reverse().map(orderCard).join('')
    : '<p class="muted">No orders' + (ORD_DAY ? ' that day' : ' yet this month') +
      '. Card payments made on the website land here by themselves.</p>';
}

/* Le fichier est protege par la cle admin, qu un lien ordinaire ne peut pas
   porter : on le recupere par fetch puis on le remet au navigateur. */
async function downloadOrdersXlsx() {
  const btn = $('#ordXlsx');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/orders?format=xlsx&month=' + encodeURIComponent(ORD_MONTH), {
      headers: { 'x-admin-key': KEY },
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || ('HTTP ' + r.status));
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'le-four-commandes-' + ORD_MONTH + '.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Excel file downloaded');
  } catch (e) {
    toast('Error: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function bindOrders() {
  const sel = $('#ordMonth');
  if (sel) sel.addEventListener('change', () => loadOrders(sel.value));
  const ref = $('#ordRefresh');
  if (ref) ref.addEventListener('click', () => loadOrders(ORD_MONTH));
  const dl = $('#ordXlsx');
  if (dl) dl.addEventListener('click', downloadOrdersXlsx);
}

async function openOrdersTab() {
  await loadOrderMonths();
  if (ORD_MONTH) await loadOrders(ORD_MONTH);
}

function bindTabs() {
  $$('.atab').forEach(b => b.addEventListener('click', () => {
    $$('.atab').forEach(x => x.classList.toggle('is-on', x === b));
    $$('.pane').forEach(p => { p.hidden = p.id !== 'pane-' + b.dataset.tab; });
    if (b.dataset.tab === 'seo') renderAlts();
    if (b.dataset.tab === 'menu') renderMenuEditor();
    if (b.dataset.tab === 'orders') openOrdersTab();
  }));
  bindOrders();
  const sb = $('#saveBtn');
  if (sb) sb.addEventListener('click', saveSettings);
  addEventListener('beforeunload', (e) => { if (DIRTY) { e.preventDefault(); e.returnValue = ''; } });
}

/* ── photo position (focal point) ────────────────────────────
   On the site every photo is cropped to fill its frame (object-fit: cover):
   a round 58px menu thumbnail, 4:3 cards, the 16:10 home photo. The owner
   drags a point onto the part that must stay visible and watches each real
   frame update. Stored per photo URL in SETTINGS.pos as "X% Y%", so a
   replaced photo starts centred instead of inheriting another photo's crop. */
const PE_FRAMES = {
  /* same aspect ratios as css/style.css; the crop depends on the ratio only,
     so previews can be drawn smaller than the real frame */
  dish: [
    { label: 'Menu list', note: 'round, 58 px', w: 58, h: 58, r: '50%' },
    { label: 'Featured strip', note: '4:3', w: 200, h: 150, r: '18px 18px 0 0' },
    { label: 'Dish details', note: '4:3', w: 280, h: 210, r: '18px' },
    { label: 'Cart', note: 'square', w: 54, h: 54, r: '11px' },
  ],
  hero: [{ label: 'Home page, under the logo', note: '16:10', w: 300, h: 188, r: '20px' }],
  gallery: [{ label: 'Chez nous gallery', note: '4:3', w: 300, h: 225, r: '18px' }],
};
const PE_HERO_FALLBACK = { label: 'Home page (until a home photo is uploaded)', note: '16:10', w: 300, h: 188, r: '20px' };

let PE = null;

function posOf(url) {
  const v = String((SETTINGS && SETTINGS.pos && SETTINGS.pos[url]) || '');
  const m = /^(\d{1,3}(?:\.\d{1,2})?)% (\d{1,3}(?:\.\d{1,2})?)%$/.exec(v);
  return m && +m[1] <= 100 && +m[2] <= 100 ? v : '50% 50%';
}

function applyAdminPositions() {
  $$('img[data-photo]').forEach(img => { img.style.objectPosition = posOf(img.dataset.photo); });
}

/* the photo the site puts on the home page while none is uploaded —
   keep in step with renderHeroShot() in main.js */
function heroFallback() {
  const pref = ['zaatar', 'zaatar-cheese', 'cheese', 'lahm'];
  return pref.map(id => DATA.dishes[id]).find(Boolean) || Object.values(DATA.dishes)[0] || '';
}

/* positions of deleted photos are dropped on save */
function prunePositions() {
  if (!SETTINGS || !SETTINGS.pos) return;
  const live = new Set([DATA.hero, ...(DATA.gallery || []), ...Object.values(DATA.dishes || {})].filter(Boolean));
  Object.keys(SETTINGS.pos).forEach(k => { if (!live.has(k)) delete SETTINGS.pos[k]; });
}

function openPosEditor(url, kind, name) {
  if (!url || !SETTINGS) return;
  const start = posOf(url);
  const [x, y] = start.split(' ').map(parseFloat);
  PE = { url, x, y, start, drag: false, wasDirty: DIRTY };
  $('#peTitle').textContent = name ? name + ' \u2014 position' : 'Photo position';
  const frames = (PE_FRAMES[kind] || PE_FRAMES.dish).slice();
  if (kind === 'dish' && !DATA.hero && heroFallback() === url) frames.push(PE_HERO_FALLBACK);
  $('#peFrames').innerHTML = frames.map(f => `<figure class="pe-fr">
      <span class="pe-box" style="width:${f.w}px;aspect-ratio:${f.w}/${f.h};border-radius:${f.r}"><img src="${url}" alt="" data-photo="${url}"></span>
      <figcaption>${f.label}<small>${f.note}</small></figcaption>
    </figure>`).join('');
  $('#peImg').src = url;
  $('#posEditor').hidden = false;
  document.body.classList.add('pe-open');
  paintPos();
  $('#peStage').focus({ preventScroll: true });
}

function paintPos() {
  if (!PE) return;
  const dot = $('#peDot');
  dot.style.left = PE.x + '%';
  dot.style.top = PE.y + '%';
  $('#peVal').textContent = 'Left ' + PE.x + '%  \u00b7  Top ' + PE.y + '%';
  applyAdminPositions();
}

function setPos(x, y) {
  if (!PE) return;
  PE.x = Math.round(Math.min(100, Math.max(0, x)));
  PE.y = Math.round(Math.min(100, Math.max(0, y)));
  const v = PE.x + '% ' + PE.y + '%';
  if (v === '50% 50%') delete SETTINGS.pos[PE.url]; else SETTINGS.pos[PE.url] = v;
  if (v !== PE.start) markDirty();
  paintPos();
}

function closePosEditor(keep) {
  if (!PE) return;
  if (!keep) {
    if (PE.start === '50% 50%') delete SETTINGS.pos[PE.url]; else SETTINGS.pos[PE.url] = PE.start;
    applyAdminPositions();
  }
  const changed = posOf(PE.url) !== PE.start;
  /* no net change and nothing else was pending: leave the dashboard as clean
     as it was - no stale save bar, no "leave this page?" prompt */
  if (!changed && !PE.wasDirty) {
    DIRTY = false;
    const bar = $('#saveBar');
    if (bar) bar.hidden = true;
  }
  PE = null;
  $('#posEditor').hidden = true;
  document.body.classList.remove('pe-open');
  $('#peImg').removeAttribute('src');
  if (changed && keep) toast('Position set \u2014 click Save changes to publish');
}

(function bindPosEditor() {
  const stage = $('#peStage');
  if (!stage) return;
  const fromEvent = (e) => {
    const r = $('#peImg').getBoundingClientRect();
    if (!r.width || !r.height) return;
    setPos((e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100);
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!PE) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    PE.drag = true;
    fromEvent(e);
  });
  stage.addEventListener('pointermove', (e) => { if (PE && PE.drag) fromEvent(e); });
  ['pointerup', 'pointercancel'].forEach(t => stage.addEventListener(t, () => { if (PE) PE.drag = false; }));
  stage.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!k || !PE) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    setPos(PE.x + k[0] * step, PE.y + k[1] * step);
  });
  $('#peReset').addEventListener('click', () => setPos(50, 50));
  $('#peDone').addEventListener('click', () => closePosEditor(true));
  $('#peCancel').addEventListener('click', () => closePosEditor(false));
  $('#posEditor').addEventListener('click', (e) => { if (e.target.id === 'posEditor') closePosEditor(true); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && PE) closePosEditor(true); });
  /* one delegated listener: the photo lists are re-rendered after every upload */
  $('#app').addEventListener('click', (e) => {
    const b = e.target.closest('[data-adj]');
    if (!b || !b.dataset.adj) return;
    e.preventDefault();
    openPosEditor(b.dataset.adj, b.dataset.kind, b.dataset.name || '');
  });
})();

/* ── login gate ─────────────────────────────────────────── */
let TABS_BOUND = false;
function showApp() {
  if (!TABS_BOUND) { TABS_BOUND = true; bindTabs(); }
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#logout').hidden = false;
}

$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  KEY = $('#pw').value;
  const err = $('#gateErr');
  err.hidden = true;
  try {
    /* check the key with a harmless protected call */
    await api('/api/photos', { method: 'POST', body: JSON.stringify({ action: 'delete', urls: [] }) });
    sessionStorage.setItem('lefour-admin', KEY);
    showApp(); await load();
  } catch (e2) {
    /* only "unauthorized" means a wrong password; any other error
       (storage not set up, empty request…) still means the key is valid */
    if (/unauthorized/i.test(e2.message)) {
      err.textContent = 'Incorrect password.'; err.hidden = false; return;
    }
    sessionStorage.setItem('lefour-admin', KEY);
    showApp();
    try { await load(); } catch (e3) { toast('Error: ' + e3.message); }
  }
});

$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem('lefour-admin');
  location.reload();
});

$('#heroInput').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) await uploadPhoto('hero', f);
  e.target.value = '';
});
$('#heroDel').addEventListener('click', () => { if (DATA.hero) removePhoto(DATA.hero); });

$('#galInput').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])];
  for (const f of files) await uploadPhoto('gallery', f);
  e.target.value = '';
});

if (KEY) { showApp(); load().catch(e => toast('Error: ' + e.message)); }

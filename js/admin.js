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
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function load() {
  DATA = await api('/api/photos?t=' + Date.now());
  const note = $('#notice');
  if (DATA.configured === false) {
    note.hidden = false;
    note.innerHTML = "Photo storage is not set up yet. In Vercel: <b>Storage → Create Database → Blob</b>, connect it to the <code>lefour</code> project, then redeploy. (The <code>BLOB_READ_WRITE_TOKEN</code> variable is added automatically.)";
  } else {
    note.hidden = true;
  }
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
  const j = await api('/api/settings');
  SETTINGS = j.settings || {};
  if (!SETTINGS.pos || typeof SETTINGS.pos !== 'object') SETTINGS.pos = {};
  fillSettingsForm();
  renderAlts();
  renderHoursEditor();
}

async function saveSettings() {
  /* checked before the button is touched, so the guard survives the finally */
  if (!validateHours()) { toast('Fix the opening hours first'); return; }
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

function bindTabs() {
  $$('.atab').forEach(b => b.addEventListener('click', () => {
    $$('.atab').forEach(x => x.classList.toggle('is-on', x === b));
    $$('.pane').forEach(p => { p.hidden = p.id !== 'pane-' + b.dataset.tab; });
    if (b.dataset.tab === 'seo') renderAlts();
  }));
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
  PE = { url, x, y, start, drag: false };
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
  const changed = keep && posOf(PE.url) !== PE.start;
  PE = null;
  $('#posEditor').hidden = true;
  document.body.classList.remove('pe-open');
  $('#peImg').removeAttribute('src');
  if (changed) toast('Position set \u2014 click Save changes to publish');
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

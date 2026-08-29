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
  DATA = await api('/api/photos');
  const note = $('#notice');
  if (DATA.configured === false) {
    note.hidden = false;
    note.innerHTML = "Photo storage is not set up yet. In Vercel: <b>Storage → Create Database → Blob</b>, connect it to the <code>lefour</code> project, then redeploy. (The <code>BLOB_READ_WRITE_TOKEN</code> variable is added automatically.)";
  } else {
    note.hidden = true;
  }
  renderGallery();
  renderDishes();
}

/* ── gallery ────────────────────────────────────────────── */
function renderGallery() {
  $('#galList').innerHTML = DATA.gallery.map(u => `
    <figure><img src="${u}" alt="" loading="lazy"><button data-del="${u}" title="Delete">✕</button></figure>
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
        <span class="thumb">${url ? `<img src="${url}" alt="" loading="lazy">` : 'none'}</span>
        <span class="rname">${it.name.en}<small>${it.id}</small></span>
        <span class="ract">
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

/* ── login gate ─────────────────────────────────────────── */
function showApp() {
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

$('#galInput').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])];
  for (const f of files) await uploadPhoto('gallery', f);
  e.target.value = '';
});

if (KEY) { showApp(); load().catch(e => toast('Error: ' + e.message)); }

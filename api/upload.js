/* POST /api/upload  (admin)
   body: { kind: 'dish'|'gallery'|'hero', id?: string, dataUrl: 'data:image/jpeg;base64,...' }

   An upload costs two advanced operations: the photo put() and the photo-list
   put(). No list(): the previous photo of a dish (or the previous home photo)
   is found in config/photos.json and deleted, and del() is free.
   See api/photos.js for why. */

const BLOB = 'https://blob.vercel-storage.com';
const V = '7';
const MAX_BYTES = 4 * 1024 * 1024;
/* the store's public address, e.g. https://abc123.public.blob.vercel-storage.com.
   Vercel's read-write token carries the store id (vercel_blob_rw_<storeId>_<secret>);
   BLOB_PUBLIC_BASE overrides it if that ever changes. */
const PUBLIC = (process.env.BLOB_PUBLIC_BASE
  || `https://${String((process.env.BLOB_READ_WRITE_TOKEN || '').split('_')[3] || '').toLowerCase()}.public.blob.vercel-storage.com`).replace(/\/+$/, '');
const MANIFEST = 'config/photos.json';

const FALLBACK_ADMIN = 'lefour2026';

function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }
function adminKey() { return process.env.ADMIN_PASSWORD || FALLBACK_ADMIN; }

function emptyList() { return { dishes: {}, gallery: [], hero: '' }; }

function cleanList(m) {
  const out = emptyList();
  if (!m || typeof m !== 'object') return out;
  if (m.dishes && typeof m.dishes === 'object') {
    for (const [k, v] of Object.entries(m.dishes)) if (typeof v === 'string' && v) out.dishes[k] = v;
  }
  if (Array.isArray(m.gallery)) out.gallery = m.gallery.filter(u => typeof u === 'string' && u);
  if (typeof m.hero === 'string') out.hero = m.hero;
  return out;
}

async function readList(fresh) {
  const r = await fetch(`${PUBLIC}/${MANIFEST}${fresh ? `?v=${Date.now()}` : ''}`);
  if (r.ok) return { state: 'ok', list: cleanList(await r.json().catch(() => null)) };
  const text = await r.text().catch(() => '');
  return { state: /store is blocked/i.test(text) ? 'blocked' : 'missing', status: r.status };
}

async function writeList(list) {
  const put = await fetch(`${BLOB}/${MANIFEST}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token()}`,
      'x-api-version': V,
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': '60',
    },
    body: JSON.stringify(list),
  });
  if (!put.ok) throw new Error(`photo list put: ${put.status} ${await put.text()}`);
}

async function listAll(prefix) {
  const out = [];
  let cursor = '';
  for (let i = 0; i < 10; i++) {
    const url = `${BLOB}?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await fetch(url, {
      headers: { authorization: `Bearer ${token()}`, 'x-api-version': V },
    });
    if (!r.ok) throw new Error(`list ${prefix}: ${r.status} ${await r.text()}`);
    const j = await r.json();
    out.push(...(j.blobs || []));
    if (!j.hasMore || !j.cursor) break;
    cursor = j.cursor;
  }
  return out;
}

/* only when the list file does not exist yet (first upload after the change) */
async function rebuildList() {
  const [dishBlobs, galBlobs, heroBlobs] = await Promise.all([listAll('dish/'), listAll('gallery/'), listAll('hero/')]);
  const byTime = (a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || ''));
  const list = emptyList();
  for (const b of dishBlobs.sort(byTime)) {
    const id = String(b.pathname || '').split('/')[1];
    if (id) list.dishes[id] = b.url;
  }
  list.gallery = galBlobs
    .sort((a, b) => String(a.pathname).localeCompare(String(b.pathname)))
    .map(b => b.url);
  const heroes = heroBlobs.sort(byTime);
  list.hero = heroes.length ? heroes[heroes.length - 1].url : '';
  return list;
}

async function del(urls) {
  if (!urls.length) return;
  await fetch(`${BLOB}/delete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'x-api-version': V, 'content-type': 'application/json' },
    body: JSON.stringify({ urls }),
  });
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if ((req.headers['x-admin-key'] || '') !== adminKey()) return res.status(401).json({ error: 'unauthorized' });
  if (!token()) return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { kind, id, dataUrl } = body;
    if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ error: 'dataUrl required' });
    if (kind !== 'dish' && kind !== 'gallery' && kind !== 'hero') return res.status(400).json({ error: 'bad kind' });
    if (kind === 'dish' && !/^[a-z0-9-]{1,40}$/i.test(id || '')) return res.status(400).json({ error: 'bad id' });

    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
    if (!m) return res.status(400).json({ error: 'unsupported image' });
    const contentType = m[1];
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'image too large' });

    /* the current list tells which old photo this one replaces */
    const got = await readList(true);
    if (got.state === 'blocked') return res.status(503).json({ error: 'storage blocked', blocked: true });
    const list = got.state === 'ok' ? got.list : await rebuildList();

    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const stamp = Date.now().toString(36);
    const pathname = kind === 'dish' ? `dish/${id}/${stamp}.${ext}`
      : kind === 'hero' ? `hero/${stamp}.${ext}`
      : `gallery/${stamp}.${ext}`;

    const put = await fetch(`${BLOB}/${pathname}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token()}`,
        'x-api-version': V,
        'x-content-type': contentType,
        'x-add-random-suffix': '0',
        'x-allow-overwrite': '1',
        'x-cache-control-max-age': '31536000',
      },
      body: bytes,
    });
    if (!put.ok) {
      const t = await put.text();
      if (/store is blocked/i.test(t)) return res.status(503).json({ error: 'storage blocked', blocked: true });
      throw new Error(`put: ${put.status} ${t}`);
    }
    const out = await put.json();

    const old = [];
    if (kind === 'dish') {
      if (list.dishes[id] && list.dishes[id] !== out.url) old.push(list.dishes[id]);
      list.dishes[id] = out.url;
    } else if (kind === 'hero') {
      if (list.hero && list.hero !== out.url) old.push(list.hero);
      list.hero = out.url;
    } else {
      list.gallery.push(out.url);
      list.gallery.sort();
    }
    /* the list first, then the old file: the site never points at a deleted photo */
    await writeList(list);
    await del(old);
    return res.status(200).json({ url: out.url, pathname });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};

/* GET  /api/photos           -> { dishes, gallery, hero, configured }
   POST /api/photos  (admin)  -> { action: 'delete', urls: [...] }

   Reading the photo list must never call list(). Vercel counts list, put and
   copy as "advanced operations", and the Hobby plan includes 2,000 a month for
   the WHOLE account: listing on every visit used them up and Vercel blocked
   every Blob store on the account (Sep 2026). The list now lives in one small
   file, config/photos.json, rewritten only when a photo is uploaded or
   deleted, and read through its public URL, where cache hits cost nothing.
   Only the signed-in dashboard may rebuild that file from the store. */

const BLOB = 'https://blob.vercel-storage.com';
const V = '7';
/* the store's public address, e.g. https://abc123.public.blob.vercel-storage.com.
   Vercel's read-write token carries the store id (vercel_blob_rw_<storeId>_<secret>);
   BLOB_PUBLIC_BASE overrides it if that ever changes. */
const PUBLIC = (process.env.BLOB_PUBLIC_BASE
  || `https://${String((process.env.BLOB_READ_WRITE_TOKEN || '').split('_')[3] || '').toLowerCase()}.public.blob.vercel-storage.com`).replace(/\/+$/, '');
const MANIFEST = 'config/photos.json';

const FALLBACK_ADMIN = 'lefour2026';

function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }
function adminKey() { return process.env.ADMIN_PASSWORD || FALLBACK_ADMIN; }
const isAdmin = (req) => (req.headers['x-admin-key'] || '') === adminKey();

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

/* public read of the list: 'ok' | 'blocked' (Vercel paused the store) | 'missing' */
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

/* 3 list() calls - only from the signed-in dashboard, when the list file is missing */
async function rebuildList() {
  const [dishBlobs, galBlobs, heroBlobs] = await Promise.all([listAll('dish/'), listAll('gallery/'), listAll('hero/')]);
  const byTime = (a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || ''));
  const list = emptyList();
  for (const b of dishBlobs.sort(byTime)) {
    const id = String(b.pathname || '').split('/')[1];
    if (id) list.dishes[id] = b.url; /* the newest upload of a dish wins */
  }
  list.gallery = galBlobs
    .sort((a, b) => String(a.pathname).localeCompare(String(b.pathname)))
    .map(b => b.url);
  const heroes = heroBlobs.sort(byTime);
  list.hero = heroes.length ? heroes[heroes.length - 1].url : '';
  return list;
}

module.exports = async (req, res) => {
  if (req.method === 'POST' && !isAdmin(req)) {
    res.setHeader('cache-control', 'no-store');
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!token()) {
    res.setHeader('cache-control', 'no-store');
    if (req.method === 'POST') return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });
    return res.status(200).json({ ...emptyList(), configured: false });
  }

  try {
    if (req.method === 'GET') {
      /* the dashboard asks with ?fresh= and bypasses every cache; visitors get
         a copy cached 15 s at the CDN (never stale-while-revalidate) */
      const fresh = !!(req.query && req.query.fresh);
      const got = await readList(fresh);
      if (got.state === 'ok') {
        res.setHeader('cache-control', fresh ? 'no-store' : 'public, max-age=0, s-maxage=15');
        return res.status(200).json({ ...got.list, configured: true });
      }
      res.setHeader('cache-control', 'no-store');
      if (got.state === 'blocked') return res.status(503).json({ error: 'storage blocked', blocked: true });
      if (!isAdmin(req)) return res.status(503).json({ error: 'photo list not built yet' });
      const list = await rebuildList();
      await writeList(list);
      return res.status(200).json({ ...list, configured: true, rebuilt: true });
    }

    if (req.method === 'POST') {
      res.setHeader('cache-control', 'no-store');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (body.action !== 'delete' || !Array.isArray(body.urls) || !body.urls.length) {
        return res.status(400).json({ error: 'bad request' });
      }
      const got = await readList(true);
      if (got.state === 'blocked') return res.status(503).json({ error: 'storage blocked', blocked: true });
      const list = got.state === 'ok' ? got.list : await rebuildList();
      const gone = new Set(body.urls);
      for (const k of Object.keys(list.dishes)) if (gone.has(list.dishes[k])) delete list.dishes[k];
      if (gone.has(list.hero)) list.hero = '';
      list.gallery = list.gallery.filter(u => !gone.has(u));
      /* the list first, so the site never points at a file that is already gone */
      await writeList(list);
      const r = await fetch(`${BLOB}/delete`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token()}`,
          'x-api-version': V,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ urls: body.urls }),
      });
      if (!r.ok) throw new Error(`delete: ${r.status} ${await r.text()}`);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.setHeader('cache-control', 'no-store');
    return res.status(500).json({ error: String(e.message || e) });
  }
};

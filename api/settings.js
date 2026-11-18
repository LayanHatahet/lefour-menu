/* GET  /api/settings          -> public settings JSON (marketing + SEO)
   POST /api/settings (admin)  -> { settings: {...} }

   Reads never call list(): Vercel counts list/put/copy as "advanced
   operations" and the Hobby plan includes 2,000 a month for the whole account
   (listing on every visit got every Blob store on the account blocked, Sep
   2026). The saved file has a fixed address, so it is read straight from its
   public URL, where cache hits cost nothing. Visitors get a copy cached 15 s
   at the CDN (never stale-while-revalidate); the dashboard asks with ?fresh=
   and bypasses every cache. A change reaches visitors within about a minute. */

const BLOB = 'https://blob.vercel-storage.com';
const V = '7';
const PATH = 'config/settings.json';
/* the store's public address, e.g. https://abc123.public.blob.vercel-storage.com.
   Vercel's read-write token carries the store id (vercel_blob_rw_<storeId>_<secret>);
   BLOB_PUBLIC_BASE overrides it if that ever changes. */
const PUBLIC = (process.env.BLOB_PUBLIC_BASE
  || `https://${String((process.env.BLOB_READ_WRITE_TOKEN || '').split('_')[3] || '').toLowerCase()}.public.blob.vercel-storage.com`).replace(/\/+$/, '');

const FALLBACK_ADMIN = 'lefour2026';

function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }
function adminKey() { return process.env.ADMIN_PASSWORD || FALLBACK_ADMIN; }

const DEFAULTS = {
  ga4: '',
  gtm: '',
  metaPixel: '',
  clarity: '',
  gscVerify: '',
  seoTitle: { fr: '', en: '', ar: '' },
  seoDesc:  { fr: '', en: '', ar: '' },
  ogImage: '',
  keywords: '',
  bizName: '', phone: '', email: '',
  /* the address is kept in its four components: Google reads them separately
     and the site composes the one-line version for display */
  address: '', city: '', province: '', postalCode: '',
  /* one "HH:MM-HH:MM" per weekday, '' = closed. 0 is Sunday, like getDay(). */
  hours: { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '', 6: '' },
  instagram: '', facebook: '', tiktok: '',
  alt: {},
  /* photo framing: { "<blob photo url>": "X% Y%" } */
  pos: {},
  /* menu edited from the dashboard. Only what the owner actually changed is
     stored, keyed by dish id; the site falls back to the menu shipped in
     data.js for anything missing. Shape:
       { "<dish id>": { price, large, box, name:{fr,en,ar}, desc:{fr,en,ar},
                        off: true,             rupture de stock
                        tax: 'on' | 'off' } }  forcer ou retirer TPS/TVQ */
  menu: {},
};

/* The value ends up in a style attribute on the public site, so only two
   plain percentages survive, and only for photos in this store. */
const POS_RE = /^(\d{1,3}(?:\.\d{1,2})?)% (\d{1,3}(?:\.\d{1,2})?)%$/;
const POS_KEY_RE = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^\s"'<>\\]{1,260}$/i;
function cleanPos(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  let n = 0;
  for (const [k, v] of Object.entries(p)) {
    if (n >= 500) break;
    if (!POS_KEY_RE.test(k)) continue;
    const m = POS_RE.exec(String(v || '').trim());
    if (!m || +m[1] > 100 || +m[2] > 100) continue;
    out[k] = m[1] + '% ' + m[2] + '%';
    n++;
  }
  return out;
}

const HOURS_RE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

/* merge() is deliberately generic, so the one field the site computes with
   gets checked here: anything that is not a real window becomes '' (closed)
   rather than reaching renderStatus() as garbage. */
function cleanHours(h) {
  const out = {};
  for (let d = 0; d < 7; d++) {
    const v = String((h && h[d]) || '').trim();
    const m = HOURS_RE.exec(v);
    if (!m) { out[d] = ''; continue; }
    const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    out[d] = b > a ? v : '';
  }
  return out;
}

/* The menu is the one thing here that money depends on, so it is validated
   hard: prices must be real non-negative numbers with at most two decimals,
   text is trimmed and capped, and anything else is dropped rather than
   stored. Empty means "use the price/text shipped with the site". */
const MENU_PRICE_KEYS = ['price', 'large', 'box'];
const MENU_LANGS = ['fr', 'en', 'ar'];
const MENU_MAX = { name: 80, desc: 600 };
const MENU_MAX_ITEMS = 300;

function cleanMenu(m) {
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  let n = 0;
  for (const id of Object.keys(m)) {
    if (n >= MENU_MAX_ITEMS) break;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(id)) continue;
    const src = m[id];
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
    const item = {};
    for (const k of MENU_PRICE_KEYS) {
      const raw = src[k];
      if (raw === '' || raw == null) continue;
      const v = Number(raw);
      /* 0 is refused on purpose: it means "not offered", and that is stored
         as the absence of the field, not as a price of zero. */
      if (!isFinite(v) || v <= 0 || v > 9999) continue;
      item[k] = Math.round(v * 100) / 100;
    }
    for (const k of ['name', 'desc']) {
      const sub = src[k];
      if (!sub || typeof sub !== 'object' || Array.isArray(sub)) continue;
      const box = {};
      for (const lg of MENU_LANGS) {
        const v = sub[lg];
        if (typeof v !== 'string') continue;
        const txt = v.trim().slice(0, MENU_MAX[k]);
        if (txt) box[lg] = txt;
      }
      if (Object.keys(box).length) item[k] = box;
    }
    /* Rupture de stock. Le plat reste visible et garde son prix : il est
       simplement signale indisponible et ne peut plus etre commande, ici
       comme a la caisse. Seul true est stocke, pour que « remis en vente »
       efface le champ au lieu d y laisser un false qui trainerait. */
    if (src.off === true || src.off === 'true' || src.off === 1) item.off = true;

    /* Taxe : rien laisse la regle decider (portion individuelle = taxee,
       six portions ou plus = non taxee), 'on' et 'off' la forcent. */
    if (src.tax === 'on' || src.tax === 'off') item.tax = src.tax;

    /* a dish with nothing overridden is not stored at all */
    if (Object.keys(item).length) { out[id] = item; n++; }
  }
  return out;
}

function merge(base, incoming) {
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k], i = incoming ? incoming[k] : undefined;
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      out[k] = (i && typeof i === 'object') ? { ...b, ...i } : b;
    } else {
      out[k] = (typeof i === 'string' || typeof i === 'number') ? String(i) : b;
    }
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method === 'POST' && (req.headers['x-admin-key'] || '') !== adminKey()) {
    res.setHeader('cache-control', 'no-store');
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!token()) {
    res.setHeader('cache-control', 'no-store');
    if (req.method === 'POST') return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });
    return res.status(200).json({ settings: DEFAULTS, configured: false });
  }

  try {
    if (req.method === 'GET') {
      const fresh = !!(req.query && req.query.fresh);
      const r = await fetch(`${PUBLIC}/${PATH}${fresh ? `?v=${Date.now()}` : ''}`);
      if (r.ok) {
        const saved = await r.json().catch(() => ({}));
        const out = merge(DEFAULTS, saved);
        out.hours = cleanHours(out.hours);
        out.menu = cleanMenu(out.menu);
        out.pos = cleanPos(out.pos);
        res.setHeader('cache-control', fresh ? 'no-store' : 'public, max-age=0, s-maxage=15');
        return res.status(200).json({ settings: out, configured: true });
      }
      const text = await r.text().catch(() => '');
      const blocked = /store is blocked/i.test(text);
      res.setHeader('cache-control', 'no-store');
      /* Only "this file does not exist" means "nothing saved yet". Any other
         failure must NOT answer with empty defaults: the dashboard would show
         blank fields and a Save would erase what the owner saved before. */
      if (r.status === 404 && !blocked) return res.status(200).json({ settings: DEFAULTS, configured: true });
      return res.status(503).json({ error: blocked ? 'storage blocked' : 'settings unavailable', blocked });
    }

    if (req.method === 'POST') {
      res.setHeader('cache-control', 'no-store');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const clean = merge(DEFAULTS, body.settings || {});
      clean.hours = cleanHours(clean.hours);
      clean.menu = cleanMenu(clean.menu);
      clean.pos = cleanPos(clean.pos);
      const put = await fetch(`${BLOB}/${PATH}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token()}`,
          'x-api-version': V,
          'x-content-type': 'application/json',
          'x-add-random-suffix': '0',
          'x-allow-overwrite': '1',
          'x-cache-control-max-age': '60',
        },
        body: JSON.stringify(clean),
      });
      if (!put.ok) {
        const t = await put.text();
        if (/store is blocked/i.test(t)) return res.status(503).json({ error: 'storage blocked', blocked: true });
        throw new Error(`put: ${put.status} ${t}`);
      }
      return res.status(200).json({ ok: true, settings: clean });
    }

    res.setHeader('allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.setHeader('cache-control', 'no-store');
    return res.status(500).json({ error: String(e.message || e) });
  }
};

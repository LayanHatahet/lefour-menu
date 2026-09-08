/* GET  /api/settings          -> public settings JSON (marketing + SEO)
   POST /api/settings (admin)  -> { settings: {...} } */

const BLOB = 'https://blob.vercel-storage.com';
const V = '7';
const PATH = 'config/settings.json';

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
};

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

async function findBlob() {
  const r = await fetch(`${BLOB}?prefix=${encodeURIComponent(PATH)}&limit=10`, {
    headers: { authorization: `Bearer ${token()}`, 'x-api-version': V },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return (j.blobs || [])[0] || null;
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', req.method === 'GET'
    ? 'public, max-age=0, s-maxage=60, stale-while-revalidate=600'
    : 'no-store');

  if (req.method === 'POST' && (req.headers['x-admin-key'] || '') !== adminKey()) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!token()) {
    if (req.method === 'POST') return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });
    return res.status(200).json({ settings: DEFAULTS, configured: false });
  }

  try {
    if (req.method === 'GET') {
      const b = await findBlob();
      if (!b) return res.status(200).json({ settings: DEFAULTS, configured: true });
      const r = await fetch(b.url + `?t=${Date.now()}`, { cache: 'no-store' });
      const saved = r.ok ? await r.json().catch(() => ({})) : {};
      const out = merge(DEFAULTS, saved);
      out.hours = cleanHours(out.hours);
      return res.status(200).json({ settings: out, configured: true });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const clean = merge(DEFAULTS, body.settings || {});
      clean.hours = cleanHours(clean.hours);
      const put = await fetch(`${BLOB}/${PATH}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token()}`,
          'x-api-version': V,
          'x-content-type': 'application/json',
          'x-add-random-suffix': '0',
          'x-allow-overwrite': '1',
          'x-cache-control-max-age': '0',
        },
        body: JSON.stringify(clean),
      });
      if (!put.ok) throw new Error(`put: ${put.status} ${await put.text()}`);
      return res.status(200).json({ ok: true, settings: clean });
    }

    res.setHeader('allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};

/* GET  /api/settings          -> public settings JSON (marketing + SEO)
   POST /api/settings (admin)  -> { settings: {...} }  saves the whole object
   Stored as a single JSON blob: config/settings.json                       */

const BLOB = 'https://blob.vercel-storage.com';
const V = '7';
const PATH = 'config/settings.json';

const FALLBACK_ADMIN = 'lefour2026';

function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }
function adminKey() { return process.env.ADMIN_PASSWORD || FALLBACK_ADMIN; }

/* every key the dashboard can edit, with safe defaults */
const DEFAULTS = {
  /* analytics / marketing ids */
  ga4: '',            // G-XXXXXXXXXX
  gtm: '',            // GTM-XXXXXXX
  metaPixel: '',      // 15-16 digit id
  clarity: '',        // Microsoft Clarity project id
  gscVerify: '',      // google-site-verification token
  /* seo */
  seoTitle: { fr: '', en: '', ar: '' },
  seoDesc:  { fr: '', en: '', ar: '' },
  ogImage: '',
  keywords: '',
  /* business / local seo (NAP) */
  bizName: '', address: '', phone: '', email: '',
  /* social */
  instagram: '', facebook: '', tiktok: '',
  /* per-image alt text: { 'dish:zaatar': '...', 'gallery:<url>': '...' } */
  alt: {},
};

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
  res.setHeader('cache-control', 'no-store');

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
      const r = await fetch(b.url + `?t=${Date.now()}`);
      const saved = r.ok ? await r.json().catch(() => ({})) : {};
      return res.status(200).json({ settings: merge(DEFAULTS, saved), configured: true });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const clean = merge(DEFAULTS, body.settings || {});
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

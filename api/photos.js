/* GET  /api/photos           → { dishes: {id: url}, gallery: [url], configured: bool }
   POST /api/photos  (admin)  → { action: 'delete', urls: [...] }
   Stockage : Vercel Blob (REST, sans dépendance npm).
   Chemins   : dish/<id>/<fichier>.jpg   ·   gallery/<fichier>.jpg          */

const BLOB = 'https://blob.vercel-storage.com';
const V = '7';

function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }

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

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');

  if (!token()) {
    return res.status(200).json({ dishes: {}, gallery: [], configured: false });
  }

  try {
    if (req.method === 'GET') {
      const [dishBlobs, galBlobs] = await Promise.all([listAll('dish/'), listAll('gallery/')]);
      const dishes = {};
      for (const b of dishBlobs) {
        const id = String(b.pathname || '').split('/')[1];
        if (id) dishes[id] = b.url;
      }
      const gallery = galBlobs
        .sort((a, b) => String(a.pathname).localeCompare(String(b.pathname)))
        .map(b => b.url);
      return res.status(200).json({ dishes, gallery, configured: true });
    }

    if (req.method === 'POST') {
      const admin = process.env.ADMIN_PASSWORD || '';
      if (!admin) return res.status(503).json({ error: 'ADMIN_PASSWORD not set' });
      if ((req.headers['x-admin-key'] || '') !== admin) return res.status(401).json({ error: 'unauthorized' });

      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (body.action !== 'delete' || !Array.isArray(body.urls) || !body.urls.length) {
        return res.status(400).json({ error: 'bad request' });
      }
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
    return res.status(500).json({ error: String(e.message || e) });
  }
};

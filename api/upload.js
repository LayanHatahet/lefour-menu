/* POST /api/upload  (admin)
   body: { kind: 'dish'|'gallery', id?: string, dataUrl: 'data:image/jpeg;base64,...' }
   → téléverse vers Vercel Blob, remplace l'ancienne photo du plat, renvoie { url } */

const BLOB = 'https://blob.vercel-storage.com';
const V = '7';
const MAX_BYTES = 4 * 1024 * 1024;

function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }

async function listPrefix(prefix) {
  const r = await fetch(`${BLOB}?prefix=${encodeURIComponent(prefix)}&limit=1000`, {
    headers: { authorization: `Bearer ${token()}`, 'x-api-version': V },
  });
  if (!r.ok) return [];
  const j = await r.json();
  return j.blobs || [];
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
  if (!token()) return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });

  const admin = process.env.ADMIN_PASSWORD || '';
  if (!admin) return res.status(503).json({ error: 'ADMIN_PASSWORD not set' });
  if ((req.headers['x-admin-key'] || '') !== admin) return res.status(401).json({ error: 'unauthorized' });

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

    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const stamp = Date.now().toString(36);
    const pathname = kind === 'dish' ? `dish/${id}/${stamp}.${ext}`
      : kind === 'hero' ? `hero/${stamp}.${ext}`
      : `gallery/${stamp}.${ext}`;

    /* remplace l'ancienne photo du plat */
    if (kind === 'dish') {
      const old = await listPrefix(`dish/${id}/`);
      await del(old.map(b => b.url));
    }
    if (kind === 'hero') {
      const old = await listPrefix('hero/');
      await del(old.map(b => b.url));
    }

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
    if (!put.ok) throw new Error(`put: ${put.status} ${await put.text()}`);
    const out = await put.json();
    return res.status(200).json({ url: out.url, pathname });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};

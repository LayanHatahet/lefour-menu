/* POST /api/stock  (admin)  -> { ok: true, off: true|false }
   body: { id: "<dish id>", off: true|false }

   Rupture de stock, en un geste. Volontairement separe de /api/settings :
   le tableau de bord garde des modifications non publiees (prix en cours de
   saisie, textes a moitie ecrits), et marquer un plat epuise pendant le coup
   de feu ne doit surtout pas publier ce brouillon au passage. Cette fonction
   relit le fichier enregistre, ne touche qu un seul champ et le reecrit.    */

const BLOB = 'https://blob.vercel-storage.com';
const V = '7';
const PATH = 'config/settings.json';

const PUBLIC = (process.env.BLOB_PUBLIC_BASE
  || `https://${String((process.env.BLOB_READ_WRITE_TOKEN || '').split('_')[3] || '').toLowerCase()}.public.blob.vercel-storage.com`).replace(/\/+$/, '');

const FALLBACK_ADMIN = 'lefour2026';
function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }
function adminKey() { return process.env.ADMIN_PASSWORD || FALLBACK_ADMIN; }

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if ((req.headers['x-admin-key'] || '') !== adminKey()) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!token()) return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String(body.id || '');
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad dish id' });
    const off = body.off === true || body.off === 'true';

    /* On lit la version enregistree, jamais celle qui traine dans l onglet :
       deux personnes peuvent avoir le tableau de bord ouvert en meme temps. */
    const r = await fetch(`${PUBLIC}/${PATH}?v=${Date.now()}`);
    let saved = {};
    if (r.ok) {
      saved = await r.json().catch(() => ({}));
    } else {
      const text = await r.text().catch(() => '');
      if (/store is blocked/i.test(text)) return res.status(503).json({ error: 'storage blocked', blocked: true });
      /* 404 = rien n a encore ete enregistre, on part d une page blanche ;
         toute autre panne doit s arreter ici plutot que d ecraser le fichier */
      if (r.status !== 404) return res.status(503).json({ error: 'settings unavailable' });
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
    if (!saved.menu || typeof saved.menu !== 'object' || Array.isArray(saved.menu)) saved.menu = {};
    if (!saved.menu[id] || typeof saved.menu[id] !== 'object') saved.menu[id] = {};

    if (off) saved.menu[id].off = true;
    else delete saved.menu[id].off;
    /* un plat remis en vente qui n a aucune autre modification redevient
       un plat ordinaire : on ne laisse pas une coquille vide derriere */
    if (!Object.keys(saved.menu[id]).length) delete saved.menu[id];

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
      body: JSON.stringify(saved),
    });
    if (!put.ok) {
      const t = await put.text().catch(() => '');
      if (/store is blocked/i.test(t)) return res.status(503).json({ error: 'storage blocked', blocked: true });
      return res.status(502).json({ error: 'could not save' });
    }
    return res.status(200).json({ ok: true, id: id, off: off });
  } catch (e) {
    console.error('stock failed:', e && e.message);
    return res.status(500).json({ error: 'stock update failed' });
  }
};

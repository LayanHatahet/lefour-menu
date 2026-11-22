/* POST /api/stock  (admin)  -> { ok: true, off: [...] }
   body: { off: ["<dish id>", ...] }   LA LISTE COMPLETE des plats epuises

   Pourquoi la liste entiere et pas « ce plat, epuise » :

   La premiere version faisait un lire-modifier-reecrire sur les reglages.
   Le Blob se lit par son adresse publique, derriere un cache : deux
   changements rapproches et le second repartait d une copie d avant le
   premier, qu il reecrivait par-dessus. Un plat remis en vente revenait
   tout seul en rupture, un plat mis en rupture ne l etait jamais — sans
   le moindre message d erreur. Le tableau de bord, lui, sait exactement
   quels plats sont epuises : qu il envoie la liste complete, et il n y a
   plus rien a relire, donc plus rien a perdre.

   La rupture vit dans son propre fichier, pas dans les reglages : « Save
   changes » ne peut donc plus la ressusciter ni l effacer au passage.   */

const BLOB = 'https://blob.vercel-storage.com';
const V = '7';
const PATH = 'config/stock.json';

const FALLBACK_ADMIN = 'lefour2026';
function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }
function adminKey() { return process.env.ADMIN_PASSWORD || FALLBACK_ADMIN; }

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const MAX_OFF = 300;

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
    if (!Array.isArray(body.off)) return res.status(400).json({ error: 'off must be a list of dish ids' });

    const seen = new Set();
    for (const raw of body.off.slice(0, MAX_OFF)) {
      const id = String(raw || '');
      if (ID_RE.test(id)) seen.add(id);
    }
    const off = [...seen].sort();

    const put = await fetch(`${BLOB}/${PATH}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token()}`,
        'x-api-version': V,
        'x-content-type': 'application/json',
        'x-add-random-suffix': '0',
        'x-allow-overwrite': '1',
        /* court : une rupture declaree pendant le service doit se voir tout
           de suite, et ce fichier ne pese que quelques octets */
        'x-cache-control-max-age': '10',
      },
      body: JSON.stringify({ off, updated: new Date().toISOString() }),
    });
    if (!put.ok) {
      const t = await put.text().catch(() => '');
      if (/store is blocked/i.test(t)) return res.status(503).json({ error: 'storage blocked', blocked: true });
      return res.status(502).json({ error: 'could not save' });
    }
    return res.status(200).json({ ok: true, off });
  } catch (e) {
    console.error('stock failed:', e && e.message);
    return res.status(500).json({ error: 'stock update failed' });
  }
};

/* Le carnet de commandes.

   Un fichier par mois, « orders/2026-11.json », lu par son adresse publique
   et reecrit entier. Jamais de list() sur le Blob : c est exactement ce qui
   avait fait bloquer le stockage pour tout le compte (une liste a chaque
   visite, 2 000 operations epuisees en quelques jours).

   Ce carnet est un index de confort, pas le registre comptable. Le registre,
   c est Stripe : chaque commande y existe avec son identifiant de session, et
   tout ce qui est ecrit ici a ete relu depuis Stripe avant d etre enregistre.
   Si ce fichier etait perdu, il se reconstruirait depuis Stripe.

   Le nom de fichier commence par un souligne : Vercel n en fait pas une
   route, c est du code partage entre /api/webhook et /api/orders.          */

const BLOB = 'https://blob.vercel-storage.com';
const V = '7';

const PUBLIC = (process.env.BLOB_PUBLIC_BASE
  || `https://${String((process.env.BLOB_READ_WRITE_TOKEN || '').split('_')[3] || '').toLowerCase()}.public.blob.vercel-storage.com`).replace(/\/+$/, '');

function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function monthPath(month) { return `orders/${month}.json`; }

/* Montreal, toujours : une commande de 21 h le 30 novembre appartient au mois
   de novembre pour la boulangerie, meme s il est deja le 1er decembre a UTC.
   Sans fuseau fixe, le releve de fin de mois se decalerait d une journee. */
const TZ = 'America/Toronto';
function montrealParts(date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  return p;
}
function monthOf(date) {
  const p = montrealParts(date);
  return `${p.year}-${p.month}`;
}
function dayOf(date) {
  const p = montrealParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
function clockOf(date) {
  const p = montrealParts(date);
  return `${p.hour}:${p.minute}`;
}

/* Lecture par l adresse publique du store : une requete CDN ordinaire, qui
   ne compte pas comme operation avancee. */
async function readMonth(month) {
  if (!MONTH_RE.test(month)) throw new Error('bad month');
  if (!token()) return { month, orders: [], missing: true };
  const r = await fetch(`${PUBLIC}/${monthPath(month)}?v=${Date.now()}`);
  if (r.ok) {
    const j = await r.json().catch(() => null);
    if (j && Array.isArray(j.orders)) return { month, orders: j.orders };
    return { month, orders: [] };
  }
  const text = await r.text().catch(() => '');
  if (/store is blocked/i.test(text)) { const e = new Error('storage blocked'); e.blocked = true; throw e; }
  /* 404 = aucune commande ce mois-la, ce qui est une reponse, pas une panne */
  if (r.status === 404) return { month, orders: [], missing: true };
  throw new Error('orders unavailable');
}

async function writeMonth(month, orders) {
  const put = await fetch(`${BLOB}/${monthPath(month)}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token()}`,
      'x-api-version': V,
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      /* court : le tableau de bord doit voir une commande tout de suite */
      'x-cache-control-max-age': '5',
    },
    body: JSON.stringify({ month, orders, updated: new Date().toISOString() }),
  });
  if (!put.ok) {
    const t = await put.text().catch(() => '');
    if (/store is blocked/i.test(t)) { const e = new Error('storage blocked'); e.blocked = true; throw e; }
    throw new Error('could not save orders');
  }
}

/* Les mois qui contiennent quelque chose. Ecrit une fois par mois, a la
   premiere commande : c est ce qui remplace un list() sur le stockage. */
const INDEX_PATH = 'orders/index.json';

async function readIndex() {
  if (!token()) return [];
  const r = await fetch(`${PUBLIC}/${INDEX_PATH}?v=${Date.now()}`);
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  const months = (j && Array.isArray(j.months)) ? j.months : [];
  return months.filter(m => MONTH_RE.test(m)).sort().reverse();
}

async function noteMonth(month) {
  const months = await readIndex();
  if (months.indexOf(month) > -1) return;
  const next = months.concat([month]).sort().reverse();
  const put = await fetch(`${BLOB}/${INDEX_PATH}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token()}`,
      'x-api-version': V,
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': '5',
    },
    body: JSON.stringify({ months: next }),
  });
  /* l index n est qu un confort : s il rate, la commande est deja
     enregistree et le mois reste consultable en le demandant par son nom */
  if (!put.ok) console.error('order month index not updated for', month);
}

/* Ajout idempotent. La meme session peut arriver deux fois — Stripe reessaie
   un webhook qui n a pas repondu 200 — et elle ne doit creer qu une ligne.
   Apres l ecriture on relit pour verifier que la ligne est bien la : deux
   paiements a la meme seconde pourraient sinon s ecraser l un l autre. */
async function addOrder(order) {
  const month = order.month;
  for (let attempt = 0; attempt < 3; attempt++) {
    const book = await readMonth(month);
    if (book.orders.some(o => o.id === order.id)) return { added: false };
    const next = book.orders.concat([order]);
    next.sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)));
    await writeMonth(month, next);
    const check = await readMonth(month);
    if (check.orders.some(o => o.id === order.id)) {
      await noteMonth(month);
      return { added: true };
    }
  }
  throw new Error('order not persisted');
}

module.exports = {
  MONTH_RE, monthOf, dayOf, clockOf, montrealParts,
  readMonth, writeMonth, addOrder, readIndex, noteMonth, token,
};

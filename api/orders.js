/* GET /api/orders                      (admin) -> { months: [...] }
   GET /api/orders?month=2026-11         (admin) -> { month, orders, totals, days }
   GET /api/orders?month=2026-11&format=xlsx     -> le releve du mois en Excel

   Tout est servi au tableau de bord et a personne d autre : ces lignes
   portent le nom, le courriel et le telephone de vrais clients.          */

const ORDERS = require('./_orders.js');
const XLSX = require('./_xlsx.js');

const FALLBACK_ADMIN = 'lefour2026';
function adminKey() { return process.env.ADMIN_PASSWORD || FALLBACK_ADMIN; }

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function monthLabel(month) {
  const [y, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

function orderLine(o) {
  return (o.items || [])
    .map(i => `${i.qty}x ${i.name}`)
    .join(' · ');
}

/* Le total du mois, et le decompte par jour pour le calendrier. */
function summarise(orders) {
  const totals = { count: orders.length, subtotal: 0, tps: 0, tvq: 0, total: 0 };
  const days = {};
  for (const o of orders) {
    totals.subtotal += Number(o.subtotal) || 0;
    totals.tps += Number(o.tps) || 0;
    totals.tvq += Number(o.tvq) || 0;
    totals.total += Number(o.total) || 0;
    const d = days[o.day] || (days[o.day] = { count: 0, total: 0 });
    d.count++;
    d.total += Number(o.total) || 0;
  }
  for (const k of ['subtotal', 'tps', 'tvq', 'total']) {
    totals[k] = Math.round(totals[k] * 100) / 100;
  }
  for (const k of Object.keys(days)) days[k].total = Math.round(days[k].total * 100) / 100;
  return { totals, days };
}

const COLUMNS = [
  { key: 'when', label: 'Date et heure', type: 'date', width: 18 },
  { key: 'ref', label: 'Référence', width: 16 },
  { key: 'name', label: 'Nom', width: 22 },
  { key: 'email', label: 'Courriel', width: 28 },
  { key: 'phone', label: 'Téléphone', width: 16 },
  { key: 'order', label: 'Commande', width: 46 },
  { key: 'note', label: 'Note', width: 28 },
  { key: 'subtotal', label: 'Sous-total', type: 'money', width: 12 },
  { key: 'tps', label: 'TPS', type: 'money', width: 10 },
  { key: 'tvq', label: 'TVQ', type: 'money', width: 10 },
  { key: 'total', label: 'Total payé', type: 'money', width: 13 },
  { key: 'receipt', label: 'Reçu demandé', width: 14 },
  { key: 'lang', label: 'Langue', width: 9 },
  { key: 'mode', label: 'Mode', width: 9 },
];

function toRows(orders) {
  return orders.map(o => ({
    /* Le Z est volontaire : o.day et o.time sont deja l heure de Montreal,
       et Excel ne connait pas les fuseaux. Sans lui, la valeur serait
       relue dans le fuseau du serveur et le releve glisserait. */
    when: `${o.day}T${o.time || '00:00'}:00Z`,
    ref: o.ref || '',
    name: o.name || '',
    email: o.email || '',
    phone: o.phone || '',
    order: orderLine(o),
    note: o.note || '',
    subtotal: o.subtotal,
    tps: o.tps,
    tvq: o.tvq,
    total: o.total,
    receipt: o.receipt ? 'Oui' : 'Non',
    lang: (o.lang || '').toUpperCase(),
    mode: o.mode || '',
  }));
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if ((req.headers['x-admin-key'] || '') !== adminKey()) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!ORDERS.token()) return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });

  const q = req.query || {};
  const month = String(q.month || '');

  try {
    if (!month) {
      const months = await ORDERS.readIndex();
      return res.status(200).json({ months });
    }
    if (!ORDERS.MONTH_RE.test(month)) return res.status(400).json({ error: 'bad month' });

    const book = await ORDERS.readMonth(month);
    const orders = book.orders || [];

    if (String(q.format || '') === 'xlsx') {
      const buf = XLSX.workbook(monthLabel(month), COLUMNS, toRows(orders));
      res.setHeader('content-type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('content-disposition',
        `attachment; filename="le-four-commandes-${month}.xlsx"`);
      return res.status(200).send(buf);
    }

    const { totals, days } = summarise(orders);
    return res.status(200).json({ month, label: monthLabel(month), orders, totals, days });
  } catch (e) {
    console.error('orders failed:', e && e.message);
    if (e && e.blocked) return res.status(503).json({ error: 'storage blocked', blocked: true });
    return res.status(503).json({ error: 'orders unavailable' });
  }
};

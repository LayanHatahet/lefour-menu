/* GET /api/orders                      (admin) -> { months: [...] }
   GET /api/orders?month=2026-11         (admin) -> { month, orders, totals, days }
   GET /api/orders?month=2026-11&format=xlsx     -> le releve du mois en Excel

   Tout est servi au tableau de bord et a personne d autre : ces lignes
   portent le nom, le courriel et le telephone de vrais clients.          */

const ORDERS = require('./_orders.js');
const XLSX = require('./_xlsx.js');
const RECEIPT = require('./_receipt.js');

const STRIPE_BASE = 'https://api.stripe.com/v1';

/* Ces lignes portent le nom, le courriel et le telephone de vrais clients.
   Elles ne partagent donc pas le mot de passe du tableau de bord photos,
   qui sert aussi au personnel — et qui, lui, a une valeur de repli ecrite
   dans un depot public. Ici il n y en a AUCUNE : sans REPORTS_PASSWORD
   pose sur Vercel, la page refuse de servir quoi que ce soit. */
function reportsKey() { return process.env.REPORTS_PASSWORD || ''; }

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
  { key: 'receipt', label: 'Reçu', width: 18 },
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
    receipt: !o.receipt ? 'Non demandé'
      : o.receiptSent ? 'Envoyé'
      : 'DEMANDÉ — non envoyé',
    lang: (o.lang || '').toUpperCase(),
    mode: o.mode || '',
  }));
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const want = reportsKey();
  if (!want) {
    return res.status(503).json({ error: 'reports password not configured' });
  }
  if ((req.headers['x-reports-key'] || '') !== want) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!ORDERS.token()) return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });

  const q = req.query || {};
  const month = String(q.month || '');

  /* Renvoyer un recu. Sert aux commandes dont l envoi avait echoue, et a
     celles d avant que l etat du recu soit suivi — pour celles-la
     l identifiant du paiement n est pas sur la commande, on le redemande
     a Stripe a partir de la session. */
  if (req.method === 'POST') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
    catch (e) { return res.status(400).json({ error: 'bad request' }); }
    if (String(body.action || '') !== 'resend-receipt') {
      return res.status(400).json({ error: 'unknown action' });
    }
    const m = String(body.month || '');
    const id = String(body.id || '');
    if (!ORDERS.MONTH_RE.test(m)) return res.status(400).json({ error: 'bad month' });
    if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(id)) return res.status(400).json({ error: 'bad order id' });

    try {
      const order = await ORDERS.findOrder(m, id);
      if (!order) return res.status(404).json({ error: 'order not found' });
      let pi = order.pi || '';
      if (!pi) {
        const r = await fetch(`${STRIPE_BASE}/checkout/sessions/${encodeURIComponent(id)}`, {
          headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY || ''}` },
        });
        const j = await r.json().catch(() => ({}));
        pi = j && j.payment_intent ? String(j.payment_intent) : '';
      }
      const out = await RECEIPT.sendReceipt(pi, order.email);
      await ORDERS.patchOrder(m, id, {
        pi: pi || order.pi || '',
        receiptSent: out.receiptSent,
        receiptAt: out.receiptAt || '',
        receiptError: out.receiptError || '',
      });
      if (!out.receiptSent) return res.status(502).json({ error: out.receiptError || 'could not send' });
      return res.status(200).json({ ok: true, sentTo: order.email });
    } catch (e) {
      console.error('resend failed:', e && e.message);
      return res.status(503).json({ error: 'could not send' });
    }
  }

  try {
    if (!month) {
      const months = await ORDERS.monthsAvailable(12);
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

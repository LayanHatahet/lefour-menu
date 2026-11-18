/* POST /api/webhook  — Stripe annonce qu un paiement est passe.

   C est ce qui rend la commande independante du navigateur du client : avant,
   la boulangerie n apprenait la commande que si le client cliquait le bouton
   WhatsApp sur la page de remerciement. Fermer l onglet suffisait a faire
   disparaitre une commande payee. Maintenant Stripe previent le serveur, et
   la commande est inscrite au carnet quoi qu il arrive ensuite.

   Deux garde-fous plutot qu un :
     1. la signature Stripe est verifiee quand STRIPE_WEBHOOK_SECRET est pose ;
     2. quoi qu il arrive, rien n est cru sur parole — la session est relue
        chez Stripe avec notre cle secrete avant d etre enregistree.
   Le deuxieme suffit a rendre un faux webhook inoffensif : au pire il nous
   fait relire une session qui existe vraiment et qui est vraiment payee.   */

const crypto = require('crypto');
const ORDERS = require('./_orders.js');

const STRIPE_BASE = 'https://api.stripe.com/v1';

function stripeKey() { return process.env.STRIPE_SECRET_KEY || ''; }
function hookSecret() { return process.env.STRIPE_WEBHOOK_SECRET || ''; }
function authHeaders() { return { authorization: `Bearer ${stripeKey()}` }; }

/* Vercel analyse le corps de la requete par defaut, ce qui detruit les octets
   exacts dont la signature a besoin. */
async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

/* Signature Stripe : HMAC-SHA256 de « timestamp.corps », compare en temps
   constant. La tolerance de cinq minutes evite qu un ancien appel capture
   soit rejoue plus tard. */
function signatureOk(raw, header, secret) {
  const parts = {};
  for (const bit of String(header || '').split(',')) {
    const i = bit.indexOf('=');
    if (i > 0) {
      const k = bit.slice(0, i).trim();
      (parts[k] = parts[k] || []).push(bit.slice(i + 1).trim());
    }
  }
  const t = parts.t && parts.t[0];
  const given = parts.v1 || [];
  if (!t || !given.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const mine = crypto.createHmac('sha256', secret)
    .update(`${t}.`).update(raw).digest('hex');
  const a = Buffer.from(mine, 'utf8');
  return given.some(g => {
    const b = Buffer.from(g, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

async function stripeGet(path) {
  const r = await fetch(`${STRIPE_BASE}${path}`, { headers: authHeaders() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((j.error && j.error.message) || `stripe ${r.status}`);
    /* « cette session n existe pas » ne s arrangera pas en reessayant : une
       cle pour l autre mode, ou un appel qui n est pas de Stripe. Marque
       comme definitif pour qu on reponde 200 et que Stripe cesse. */
    err.permanent = r.status === 404 || (j.error && j.error.code === 'resource_missing');
    throw err;
  }
  return j;
}

/* Le recu : Stripe l envoie lui-meme des qu une adresse est posee sur le
   paiement. On ne la pose que si le client a coche oui. */
async function sendReceipt(paymentIntentId, email) {
  const r = await fetch(`${STRIPE_BASE}/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/x-www-form-urlencoded' },
    body: `receipt_email=${encodeURIComponent(email)}`,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    console.error('receipt not sent:', (j.error && j.error.message) || r.status);
    return false;
  }
  return true;
}

function customField(session, key) {
  for (const f of (session.custom_fields || [])) {
    if (f.key !== key) continue;
    if (f.dropdown && typeof f.dropdown.value === 'string') return f.dropdown.value;
    if (f.text && typeof f.text.value === 'string') return f.text.value;
  }
  return '';
}

/* « zaatar:R:2|hummus:R:1 » -> lignes reutilisables pour recommander */
function parseCart(meta) {
  const raw = String((meta && meta.cart) || '') + String((meta && meta.cart2) || '');
  const out = [];
  for (const bit of raw.split('|')) {
    const p = bit.split(':');
    if (p.length !== 3) continue;
    const qty = Number(p[2]);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(p[0]) || !isFinite(qty) || qty < 1) continue;
    out.push({ id: p[0], size: p[1], qty: Math.floor(qty) });
  }
  return out;
}

async function buildOrder(session) {
  const li = await stripeGet(
    `/checkout/sessions/${encodeURIComponent(session.id)}/line_items?limit=100&expand[]=data.taxes`);

  let tps = 0, tvq = 0;
  const items = (li.data || []).map(row => {
    const line = { name: row.description || '', qty: row.quantity || 1,
                   total: (row.amount_total || 0) / 100, tax: (row.amount_tax || 0) / 100 };
    for (const tx of (row.taxes || [])) {
      const name = (tx.rate && tx.rate.display_name) || '';
      if (/TPS|GST/i.test(name)) tps += tx.amount || 0;
      else if (/TVQ|QST/i.test(name)) tvq += tx.amount || 0;
    }
    return line;
  });

  /* Le panier compact garde l identifiant du plat et le format, que le
     libelle affiche ne porte pas : c est lui qui permet de recommander. */
  const cart = parseCart(session.metadata);
  cart.forEach((c, i) => { if (items[i]) { items[i].dish = c.id; items[i].size = c.size; } });

  const d = session.customer_details || {};
  const paid = new Date((session.created || Math.floor(Date.now() / 1000)) * 1000);
  const money = (c) => (typeof c === 'number' ? c / 100 : null);

  return {
    id: session.id,
    ref: String(session.id).slice(-12),
    month: ORDERS.monthOf(paid),
    day: ORDERS.dayOf(paid),
    time: ORDERS.clockOf(paid),
    paidAt: paid.toISOString(),
    name: d.name || '',
    email: d.email || '',
    phone: d.phone || '',
    lang: (session.metadata && session.metadata.lang) || 'fr',
    note: (session.metadata && session.metadata.note) || '',
    receipt: customField(session, 'receipt') === 'yes',
    items,
    cart,
    subtotal: money(session.amount_subtotal),
    tps: tps / 100,
    tvq: tvq / 100,
    tax: session.total_details ? money(session.total_details.amount_tax) : null,
    total: money(session.amount_total),
    currency: (session.currency || 'cad').toUpperCase(),
    mode: session.livemode ? 'live' : 'test',
    source: 'web',
  };
}

const HANDLED = {
  'checkout.session.completed': true,
  'checkout.session.async_payment_succeeded': true,
};

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!stripeKey()) return res.status(503).json({ error: 'STRIPE_SECRET_KEY not set' });

  let event;
  try {
    let raw = await rawBody(req);

    /* Si la plateforme a quand meme analyse le corps avant nous, le flux
       arrive vide. On repart alors de l objet deja analyse : la signature
       n est plus verifiable — les octets exacts sont perdus — mais la
       commande ne doit pas disparaitre pour autant. Elle sera de toute
       facon relue chez Stripe avant d etre enregistree, et c est cette
       relecture qui fait foi. */
    let signable = raw.length > 0;
    if (!signable && req.body) {
      raw = Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body), 'utf8');
      console.warn('webhook body was pre-parsed — signature not checked, falling back to a Stripe lookup');
    }

    const secret = hookSecret();
    if (secret && signable && !signatureOk(raw, req.headers['stripe-signature'], secret)) {
      return res.status(400).json({ error: 'bad signature' });
    }
    event = JSON.parse(raw.toString('utf8') || '{}');
  } catch (e) {
    return res.status(400).json({ error: 'unreadable payload' });
  }

  const type = String(event && event.type || '');
  if (!HANDLED[type]) return res.status(200).json({ ignored: type });

  const sessionId = event.data && event.data.object && event.data.object.id;
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(String(sessionId || ''))) {
    return res.status(400).json({ error: 'no session id' });
  }

  try {
    /* Relecture chez Stripe : l evenement n est qu un signal, la verite
       vient de l API, authentifiee avec notre cle. */
    const session = await stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (session.payment_status !== 'paid') return res.status(200).json({ skipped: 'not paid' });
    if (!session.metadata || session.metadata.fulfilment !== 'pickup') {
      return res.status(200).json({ skipped: 'not one of ours' });
    }

    const order = await buildOrder(session);
    const { added } = await ORDERS.addOrder(order);

    if (added && order.receipt && order.email && session.payment_intent) {
      await sendReceipt(String(session.payment_intent), order.email);
    }
    return res.status(200).json({ ok: true, added, ref: order.ref });
  } catch (e) {
    console.error('webhook failed:', e && e.message);
    if (e && e.permanent) return res.status(200).json({ skipped: 'unknown session' });
    if (e && e.blocked) return res.status(503).json({ error: 'storage blocked' });
    /* 500 = Stripe reessaiera, et addOrder() ne cree pas de doublon */
    return res.status(500).json({ error: 'not recorded' });
  }
};

/* indispensable : sans cela Vercel consomme le corps et la signature ne
   peut plus etre verifiee */
module.exports.config = { api: { bodyParser: false } };

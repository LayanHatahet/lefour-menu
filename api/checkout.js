/* GET  /api/checkout  -> { configured: true|false, mode: 'test'|'live' }
   POST /api/checkout  -> { url }  a Stripe Checkout session to redirect to

   Stripe Checkout is Stripe's own hosted page: no card detail ever reaches
   this site or this function.

   There is no node_modules in this deployment (same as photos/settings/upload),
   so Stripe is called over its REST API with fetch and form-encoded bodies
   rather than the npm package.

   THE CART IS NEVER TRUSTED. The browser sends dish ids, sizes and quantities
   only; every price is looked up again here from /menu-prices.json (generated
   at build time from the deployed menu) with the dashboard overrides applied
   on top, exactly as the site applies them. A tampered cart cannot change what
   the customer is charged.                                                   */

const STRIPE_BASE = 'https://api.stripe.com/v1';
const STRIPE_API = `${STRIPE_BASE}/checkout/sessions`;

/* ── Taxes (Quebec) ─────────────────────────────────────────────────
   Regle donnee par le client, qui est aussi celle de Revenu Quebec sur
   les produits de boulangerie :

     Boite de 6, douzaine de bouchees : jamais de taxe.
     Sandwich (format L)              : toujours taxe, quelle que soit
                                        la quantite — c est un repas
                                        prepare, pas de l epicerie.
     Manouche reguliere               : taxee tant qu il y en a MOINS DE
                                        SIX dans la commande. A partir de
                                        six, plus aucune taxe dessus.
     Le reste (pizzas, mezze, boissons) : taxe.

   Le compte des six porte sur LA COMMANDE, pas sur le plat : une zaatar
   plus cinq fromages font six regulieres, donc aucune taxe. Cinq seulement
   et tout est taxe. C est pour cela que la taxe ne peut pas se decider
   ligne par ligne : il faut d abord avoir lu tout le panier.

   La TVQ se calcule sur le prix avant TPS, pas l une sur l autre :
   deux taux exclusifs appliques a la meme base, jamais composes. */
const TAX_SPECS = [
  { key: 'tps', display_name: 'TPS', percentage: '5',
    tax_type: 'gst', description: 'TPS 5 % — Canada' },
  { key: 'tvq', display_name: 'TVQ', percentage: '9.975',
    tax_type: 'qst', description: 'TVQ 9,975 % — Québec' },
];

/* B = boite de 6, 12 = douzaine de bouchees : six portions ou plus. */
const UNTAXED_SIZES = { B: true, '12': true };

/* Le seuil des manouches regulieres. */
const BULK_REGULARS = 6;

/* `bulk` = la commande contient six manouches regulieres ou plus.
   Le tableau de bord peut forcer le resultat plat par plat :
   '' ou absent = la regle, 'on' = toujours taxe, 'off' = jamais. */
function lineTaxable(cat, sizeKey, ov, bulk) {
  const forced = ov && typeof ov.tax === 'string' ? ov.tax : '';
  if (forced === 'on') return true;
  if (forced === 'off') return false;
  if (UNTAXED_SIZES[sizeKey]) return false;
  if (cat === 'minis') return false;
  if (sizeKey === 'L') return true;
  if (cat === 'manakish' && sizeKey === 'R') return !bulk;
  return true;
}

/* Les manouches regulieres reellement facturees — un plat epuise a ete
   ecarte plus haut et ne doit pas compter dans les six. */
function countRegulars(lines) {
  let n = 0;
  for (const li of lines) {
    if (li.meta.cat === 'manakish' && li.meta.sizeKey === 'R') n += li.quantity;
  }
  return n;
}

function stripeHeaders() {
  return {
    authorization: `Bearer ${stripeKey()}`,
    'content-type': 'application/x-www-form-urlencoded',
  };
}

/* Les deux taux vivent dans le compte Stripe, pas dans le code : Stripe
   les affiche alors comme deux lignes nommees sur la page de paiement et
   sur le recu. On les cree au premier paiement et on retient leurs ids
   pour la duree du conteneur — le mode test et le mode reel ont chacun
   les siens, et c est la cle en place qui decide lesquels on touche. */
let TAX_MEMO = null;
async function taxRateIds() {
  if (TAX_MEMO) return TAX_MEMO;
  const found = {};
  const r = await fetch(`${STRIPE_BASE}/tax_rates?limit=100`, { headers: stripeHeaders() });
  const j = await r.json().catch(() => ({}));
  for (const tr of (j && j.data) || []) {
    const key = tr && tr.metadata && tr.metadata.lefour;
    const spec = TAX_SPECS.find(x => x.key === key);
    /* un taux au mauvais pourcentage n est pas reutilise : si Quebec change
       la TVQ, on en cree un nouveau plutot que de corriger l ancien, pour
       que les anciens recus gardent le taux qui leur a ete applique. */
    if (!spec || tr.active === false) continue;
    if (Number(tr.percentage) !== Number(spec.percentage)) continue;
    found[key] = tr.id;
  }
  for (const spec of TAX_SPECS) {
    if (found[spec.key]) continue;
    const body = formEncode({
      display_name: spec.display_name,
      description: spec.description,
      percentage: spec.percentage,
      inclusive: false,
      tax_type: spec.tax_type,
      country: 'CA',
      state: 'QC',
      jurisdiction: 'Québec',
      metadata: { lefour: spec.key },
    }).join('&');
    const cr = await fetch(`${STRIPE_BASE}/tax_rates`, {
      method: 'POST', headers: stripeHeaders(), body,
    });
    const cj = await cr.json().catch(() => ({}));
    if (!cr.ok || !cj.id) throw new Error(`tax rate ${spec.key}: ${(cj.error && cj.error.message) || cr.status}`);
    found[spec.key] = cj.id;
  }
  TAX_MEMO = TAX_SPECS.map(x => found[x.key]);
  return TAX_MEMO;
}

/* Only ever read from the environment. The key is never in the code or the
   repo: add STRIPE_SECRET_KEY in Vercel -> Project -> Settings -> Env Vars. */
function stripeKey() { return process.env.STRIPE_SECRET_KEY || ''; }

const MAX_LINES = 40;
const MAX_QTY = 50;
const SIZE_FIELD = { R: 'price', L: 'large', B: 'box', '12': 'price' };
const SIZE_LABEL = {
  fr: { R: 'Régulier', L: 'Sandwich', B: 'Boîte de 6', '12': 'Boîte de 12' },
  en: { R: 'Regular', L: 'Wrap', B: 'Box of 6', '12': 'Box of 12' },
  ar: { R: 'عادي', L: 'سندويش', B: 'علبة ٦', '12': 'علبة ١٢' },
};
const LANGS = ['fr', 'en', 'ar'];

/* Le recu par courriel est propose, pas impose : Stripe demande de toute
   facon une adresse pour la transaction, mais rien n est envoye tant que
   le client n a pas dit oui. C est le webhook qui pose alors receipt_email
   sur le paiement, et Stripe envoie son propre recu.
   Pour que ce choix veuille dire quelque chose, l envoi automatique de
   Stripe (Settings -> Emails -> Successful payments) doit rester ferme ;
   sinon tout le monde recoit un recu, qu il l ait demande ou non. */
const RECEIPT_FIELD = {
  fr: { label: 'Recevoir le reçu par courriel', yes: 'Oui, merci', no: 'Non' },
  en: { label: 'Email me the receipt', yes: 'Yes, please', no: 'No' },
  ar: { label: 'ابعتولي الإيصال عالإيميل', yes: 'نعم', no: 'لا' },
};

function receiptField(lang) {
  const c = RECEIPT_FIELD[lang] || RECEIPT_FIELD.fr;
  return {
    key: 'receipt',
    type: 'dropdown',
    label: { type: 'custom', custom: c.label },
    optional: false,
    dropdown: {
      default_value: 'yes',
      options: [
        { label: c.yes, value: 'yes' },
        { label: c.no, value: 'no' },
      ],
    },
  };
}

/* Stripe's API takes form encoding, including for nested fields:
   line_items[0][price_data][unit_amount]=400 */
function formEncode(obj, prefix, out) {
  out = out || [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out;
}

function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'lefourboulangerie.com';
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return `${proto}://${host}`;
}

/* the menu as deployed, plus whatever the owner changed in the dashboard */
async function priceBook(origin) {
  const [baseRes, setRes] = await Promise.all([
    fetch(`${origin}/menu-prices.json`),
    fetch(`${origin}/api/settings`).catch(() => null),
  ]);
  if (!baseRes || !baseRes.ok) throw new Error('menu-prices.json unavailable');
  const base = await baseRes.json();

  let overrides = {};
  if (setRes && setRes.ok) {
    const j = await setRes.json().catch(() => null);
    const m = j && j.settings && j.settings.menu;
    if (m && typeof m === 'object') overrides = m;
  }
  return { items: base.items || {}, overrides, currency: base.currency || 'cad' };
}

/* same rule as the site: a dashboard price counts only if it is a real
   number above zero, otherwise the price shipped with the menu wins */
function resolvePrice(baseItem, ov, field) {
  const o = ov && ov[field];
  const n = typeof o === 'string' && o.trim() !== '' ? Number(o) : o;
  if (typeof n === 'number' && isFinite(n) && n > 0) return n;
  const b = baseItem[field];
  return (typeof b === 'number' && isFinite(b) && b > 0) ? b : null;
}

function resolveName(baseItem, ov, lang) {
  const o = ov && ov.name && ov.name[lang];
  if (typeof o === 'string' && o.trim()) return o.trim();
  return (baseItem.name && baseItem.name[lang]) || (baseItem.name && baseItem.name.fr) || '';
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'GET') {
    /* ?session_id=... -> le recapitulatif de la commande payee, pour que la
       page /merci puisse proposer de l envoyer a la boulangerie sur WhatsApp.
       On ne renvoie que ce que le client vient lui-meme de saisir et de payer,
       et seulement si Stripe confirme le paiement. */
    const sid = (req.query && req.query.session_id) || '';
    if (!sid) {
      /* le prefixe de la cle dit le mode. On ne renvoie que le mot :
         aucune partie de la cle ne sort d ici. */
      const k = stripeKey();
      return res.status(200).json({
        configured: !!k,
        mode: k ? (k.indexOf('sk_live') === 0 ? 'live' : 'test') : null,
      });
    }
    if (!stripeKey()) return res.status(503).json({ error: 'STRIPE_SECRET_KEY not set' });
    if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sid)) return res.status(400).json({ error: 'bad session id' });
    try {
      const r = await fetch(`${STRIPE_API}/${encodeURIComponent(sid)}`, {
        headers: { authorization: `Bearer ${stripeKey()}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(404).json({ error: 'session not found' });
      if (j.payment_status !== 'paid') return res.status(200).json({ paid: false });
      const d = j.customer_details || {};
      return res.status(200).json({
        paid: true,
        amount: typeof j.amount_total === 'number' ? j.amount_total / 100 : null,
        subtotal: typeof j.amount_subtotal === 'number' ? j.amount_subtotal / 100 : null,
        tax: j.total_details && typeof j.total_details.amount_tax === 'number'
          ? j.total_details.amount_tax / 100 : null,
        currency: (j.currency || 'cad').toUpperCase(),
        order: (j.metadata && j.metadata.order) || '',
        note: (j.metadata && j.metadata.note) || '',
        lang: (j.metadata && j.metadata.lang) || 'fr',
        name: d.name || '',
        phone: d.phone || '',
        ref: String(sid).slice(-12),
      });
    } catch (e) {
      console.error('session lookup failed:', e && e.message);
      return res.status(500).json({ error: 'lookup failed' });
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!stripeKey()) {
    return res.status(503).json({ error: 'STRIPE_SECRET_KEY not set' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const lang = LANGS.indexOf(body.lang) > -1 ? body.lang : 'fr';
    const cart = Array.isArray(body.items) ? body.items.slice(0, MAX_LINES) : [];
    if (!cart.length) return res.status(400).json({ error: 'empty cart' });

    const origin = siteOrigin(req);
    const book = await priceBook(origin);

    const line_items = [];
    const summary = [];
    const soldOut = [];
    const compact = [];
    for (const raw of cart) {
      const id = String(raw && raw.id || '');
      const base = book.items[id];
      if (!base) continue;
      /* Rupture de stock declaree au tableau de bord. Le site grise deja le
         plat, mais un panier garde en memoire avant la rupture arriverait
         encore ici : on le laisse tomber plutot que d encaisser un plat
         que la boulangerie ne peut pas servir. */
      if (book.overrides[id] && book.overrides[id].off) { soldOut.push(id); continue; }

      const sizeKey = SIZE_FIELD[raw.size] ? String(raw.size) : 'R';
      const field = SIZE_FIELD[sizeKey];
      const unit = resolvePrice(base, book.overrides[id], field);
      if (unit == null) continue;                      /* size not sold -> skip */

      let qty = Math.floor(Number(raw.qty));
      if (!isFinite(qty) || qty < 1) qty = 1;
      if (qty > MAX_QTY) qty = MAX_QTY;

      const name = resolveName(base, book.overrides[id], lang);
      const sizeLabel = (SIZE_LABEL[lang] || SIZE_LABEL.fr)[sizeKey];
      const label = base.cat === 'minis' || sizeKey === '12'
        ? name
        : `${name} — ${sizeLabel}`;

      line_items.push({
        quantity: qty,
        /* de quoi trancher une fois tout le panier lu ; retire avant
           l envoi a Stripe */
        meta: { cat: base.cat, sizeKey: sizeKey, ov: book.overrides[id] },
        price_data: {
          currency: book.currency,
          unit_amount: Math.round(unit * 100),
          product_data: { name: label.slice(0, 250) },
        },
      });
      summary.push(`${qty}x ${name} (${sizeLabel})`);
      /* « zaatar:R:2 » — de quoi refaire exactement la meme commande plus
         tard depuis l historique du client, sans dependre du libelle
         affiche, qui depend de la langue et peut changer. */
      compact.push(`${id}:${sizeKey}:${qty}`);
    }

    if (!line_items.length) {
      return res.status(400).json(soldOut.length
        ? { error: 'sold out', soldOut: soldOut }
        : { error: 'nothing payable in this cart' });
    }
    /* un panier partiellement servable : on le dit au site, qui previent
       avant d envoyer le client vers une page de paiement incomplete */
    if (soldOut.length) return res.status(409).json({ error: 'sold out', soldOut: soldOut });

    /* Maintenant seulement : le panier est connu, donc le seuil des six
       manouches regulieres aussi. */
    const bulk = countRegulars(line_items) >= BULK_REGULARS;
    const taxable = line_items.map(li => lineTaxable(li.meta.cat, li.meta.sizeKey, li.meta.ov, bulk));

    /* On ne va chercher les taux que s il y a vraiment quelque chose a taxer :
       un panier de boites de 6 n a aucune raison d appeler Stripe pour rien. */
    const rates = taxable.some(Boolean) ? await taxRateIds() : null;
    line_items.forEach((li, i) => {
      if (taxable[i] && rates) li.tax_rates = rates;
      delete li.meta;
    });

    const note = String(body.note || '').trim().slice(0, 450);
    const payload = {
      mode: 'payment',
      locale: lang === 'ar' ? 'auto' : lang,
      success_url: `${origin}/merci?lang=${lang}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/commande-annulee?lang=${lang}`,
      phone_number_collection: { enabled: true },
      custom_fields: [receiptField(lang)],
      /* orders are collected at the bakery */
      custom_text: {
        submit: {
          message: {
            fr: 'Commande à récupérer à la boulangerie. On vous confirme l’heure par WhatsApp.',
            en: 'Pickup order. We confirm your pickup time on WhatsApp.',
            ar: 'الطلب للاستلام من المخبز. منأكدلك وقت الاستلام عبر واتساب.',
          }[lang],
        },
      },
      /* Tout se ramasse a Pierrefonds et se regle en dollars canadiens.
         Sans ceci, Stripe propose la devise locale du visiteur (Adaptive
         Pricing) : un client a l etranger voyait son total en livres
         turques, avec les frais de conversion qui vont avec. */
      adaptive_pricing: { enabled: false },
      /* Sans cette liste, Stripe affiche tout ce qui est active dans le
         compte, Klarna comprise : un paiement en plusieurs fois n a aucun
         sens pour un manouche a 4 $. « card » couvre aussi Apple Pay et
         Google Pay, qui restent proposes. */
      payment_method_types: ['card'],
      /* Stripe plafonne chaque valeur a 500 caracteres : un gros panier
         passe sur une deuxieme cle plutot que d etre tronque au milieu
         d une ligne. Au-dela, la commande reste lisible dans `order`. */
      metadata: {
        order: summary.join(', ').slice(0, 450),
        cart: compact.join('|').slice(0, 480),
        cart2: compact.join('|').slice(480, 960),
        note: note,
        lang: lang,
        fulfilment: 'pickup',
      },
      line_items: line_items,
    };

    const post = (body) => fetch(STRIPE_API, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${stripeKey()}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formEncode(body).join('&'),
    });

    let r = await post(payload);
    let j = await r.json().catch(() => ({}));

    /* adaptive_pricing n est pas accepte par tous les comptes. S il est
       refuse, on reessaie sans : mieux vaut un paiement avec conversion
       qu un paiement impossible. */
    if (!r.ok && j.error && /adaptive_pricing/.test(JSON.stringify(j.error))) {
      console.warn('adaptive_pricing refused by this account — retrying without it');
      const fallback = Object.assign({}, payload);
      delete fallback.adaptive_pricing;
      r = await post(fallback);
      j = await r.json().catch(() => ({}));
    }

    if (!r.ok || !j.url) {
      /* Stripe's own message is the useful one, but the key must never leak */
      const msg = (j.error && j.error.message) || `stripe ${r.status}`;
      console.error('stripe session failed:', msg);
      return res.status(502).json({ error: msg });
    }
    return res.status(200).json({ url: j.url });
  } catch (e) {
    console.error('checkout error:', e && e.message);
    return res.status(500).json({ error: 'checkout failed' });
  }
};

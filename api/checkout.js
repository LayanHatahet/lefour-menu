/* GET  /api/checkout  -> { configured: true|false }   (is online payment on?)
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

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

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
    return res.status(200).json({ configured: !!stripeKey() });
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
    for (const raw of cart) {
      const id = String(raw && raw.id || '');
      const base = book.items[id];
      if (!base) continue;

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
        price_data: {
          currency: book.currency,
          unit_amount: Math.round(unit * 100),
          product_data: { name: label.slice(0, 250) },
        },
      });
      summary.push(`${qty}x ${name} (${sizeLabel})`);
    }

    if (!line_items.length) return res.status(400).json({ error: 'nothing payable in this cart' });

    const note = String(body.note || '').trim().slice(0, 450);
    const payload = {
      mode: 'payment',
      locale: lang === 'ar' ? 'auto' : lang,
      success_url: `${origin}/merci?lang=${lang}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/commande-annulee?lang=${lang}`,
      phone_number_collection: { enabled: true },
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
      metadata: {
        order: summary.join(', ').slice(0, 450),
        note: note,
        lang: lang,
        fulfilment: 'pickup',
      },
      line_items: line_items,
    };

    const r = await fetch(STRIPE_API, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${stripeKey()}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formEncode(payload).join('&'),
    });
    const j = await r.json().catch(() => ({}));
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

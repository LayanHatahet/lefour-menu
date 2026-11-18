/* GET  /api/account                      -> { signedIn, email, name, orders }
   POST /api/account { action: 'register' | 'login' | 'logout', email, password }

   Le compte est facultatif. On peut commander toute sa vie sans en creer un ;
   il ne sert qu a retrouver ses commandes passees et a les refaire d un
   geste. Rien n y est demande de plus que ce que la caisse demandait deja.

   L historique existe avant le compte : le webhook le remplit des la
   premiere commande, range sous une empreinte du courriel. Creer un compte
   ne fait que poser un mot de passe sur une histoire deja ecrite.         */

const crypto = require('crypto');
const ORDERS = require('./_orders.js');

const COOKIE = 'lf_session';
const DAYS = 60;

/* Le meme secret que les chemins de stockage : deja present, deja secret.
   S il change, les sessions ouvertes retombent sur l ecran de connexion —
   gênant, jamais dangereux. */
function secret() {
  return process.env.CUSTOMER_SECRET || process.env.BLOB_READ_WRITE_TOKEN || '';
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function makeToken(email) {
  const exp = Date.now() + DAYS * 86400000;
  const payload = `${b64(email)}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const bits = String(token || '').split('.');
  if (bits.length !== 3) return null;
  const payload = `${bits[0]}.${bits[1]}`;
  const want = Buffer.from(sign(payload), 'utf8');
  const got = Buffer.from(bits[2], 'utf8');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  if (!(Number(bits[1]) > Date.now())) return null;
  try { return unb64(bits[0]); } catch (e) { return null; }
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function setCookie(res, value, maxAge) {
  res.setHeader('set-cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`);
}

/* ── mot de passe ─────────────────────────────────────────────────────
   scrypt : lent exprès, pour qu un fichier vole ne se devine pas au
   dictionnaire. Le sel est tire au hasard pour chaque compte. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
      (err, key) => (err ? reject(err) : resolve(key.toString('base64'))));
  });
}

async function makeSecret(password) {
  const salt = crypto.randomBytes(16).toString('base64');
  return { alg: 'scrypt', salt, hash: await hashPassword(password, salt) };
}

async function checkPassword(record, password) {
  const pw = record && record.pw;
  if (!pw || !pw.salt || !pw.hash) return false;
  const got = Buffer.from(await hashPassword(password, pw.salt), 'utf8');
  const want = Buffer.from(pw.hash, 'utf8');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* ── garde-fou contre le tatonnement ──────────────────────────────────
   En memoire : remis a zero a chaque demarrage a froid, donc imparfait.
   Avec scrypt derriere, cela suffit a rendre le tatonnement inutile sans
   ajouter un stockage pour si peu. */
const TRIES = new Map();
const MAX_TRIES = 8;
const WINDOW = 10 * 60 * 1000;

function tooMany(key) {
  const now = Date.now();
  const hit = TRIES.get(key);
  if (!hit || now - hit.at > WINDOW) return false;
  return hit.n >= MAX_TRIES;
}
function noteTry(key, ok) {
  const now = Date.now();
  if (ok) { TRIES.delete(key); return; }
  const hit = TRIES.get(key);
  if (!hit || now - hit.at > WINDOW) TRIES.set(key, { n: 1, at: now });
  else { hit.n++; hit.at = now; }
  if (TRIES.size > 5000) TRIES.clear();
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

function publicView(record) {
  const orders = (record && Array.isArray(record.orders) ? record.orders : []).map(o => ({
    ref: o.ref, paidAt: o.paidAt, day: o.day, time: o.time,
    total: o.total, currency: o.currency,
    items: o.items || [],
    /* ce qu il faut pour refaire la commande, rien de plus */
    cart: (o.cart || []).filter(c => c && c.id),
  }));
  return { name: (record && record.name) || '', orders };
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');

  if (!ORDERS.token()) {
    return res.status(200).json({ signedIn: false, available: false });
  }

  const email = readToken(cookieValue(req.headers.cookie, COOKIE));

  if (req.method === 'GET') {
    if (!email) return res.status(200).json({ signedIn: false, available: true });
    try {
      const rec = await ORDERS.readCustomer(email);
      return res.status(200).json({ signedIn: true, available: true, email, ...publicView(rec) });
    } catch (e) {
      return res.status(503).json({ error: 'history unavailable' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
  catch (e) { return res.status(400).json({ error: 'bad request' }); }

  const action = String(body.action || '');

  if (action === 'logout') {
    setCookie(res, '', 0);
    return res.status(200).json({ signedIn: false });
  }

  const addr = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (action !== 'register' && action !== 'login') {
    return res.status(400).json({ error: 'unknown action' });
  }
  if (!EMAIL_RE.test(addr)) return res.status(400).json({ error: 'bad email' });
  if (password.length < 8) return res.status(400).json({ error: 'password too short' });
  if (password.length > 200) return res.status(400).json({ error: 'password too long' });

  const who = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(who + '|' + addr)) {
    return res.status(429).json({ error: 'too many attempts' });
  }

  try {
    let rec = await ORDERS.readCustomer(addr);

    if (action === 'register') {
      /* Un compte existant n est JAMAIS ecrase : sans cela, n importe qui
         pourrait « creer » un compte sur l adresse d un autre et reprendre
         son historique. En revanche, un historique sans mot de passe —
         quelqu un qui avait deja commande en invite — accepte le sien. */
      if (rec && rec.pw) {
        return res.status(409).json({ error: 'account exists' });
      }
      if (!rec || typeof rec !== 'object') rec = { email: addr, orders: [] };
      rec.pw = await makeSecret(password);
      rec.createdAt = new Date().toISOString();
      await ORDERS.writeCustomer(addr, rec);
      setCookie(res, makeToken(addr), DAYS * 86400);
      noteTry(who + '|' + addr, true);
      return res.status(200).json({ signedIn: true, email: addr, ...publicView(rec) });
    }

    const ok = rec && await checkPassword(rec, password);
    noteTry(who + '|' + addr, !!ok);
    if (!ok) return res.status(401).json({ error: 'wrong email or password' });
    setCookie(res, makeToken(addr), DAYS * 86400);
    return res.status(200).json({ signedIn: true, email: addr, ...publicView(rec) });
  } catch (e) {
    console.error('account failed:', e && e.message);
    if (e && e.blocked) return res.status(503).json({ error: 'storage blocked' });
    return res.status(503).json({ error: 'account unavailable' });
  }
};

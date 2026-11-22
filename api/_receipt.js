/* Le recu par courriel.

   Le client a demande que, s il coche « oui », le recu parte — pas « en
   general », mais a tous les coups. Ce qui s est passe le 19 novembre
   montre pourquoi il fallait y revenir : l envoi etait la derniere etape
   d une chaine, et tout ce qui echouait avant l emportait avec lui. Un
   client a coche oui et n a jamais rien recu.

   Le recu est maintenant envoye AVANT l enregistrement de la commande, et
   le fait qu il soit parti est inscrit sur la commande. Trois filets :
     1. l envoi passe en premier, donc rien de ce qui suit ne peut
        l empecher ;
     2. il est retente a chaque fois que Stripe rejoue l evenement, tant
        que la commande ne porte pas la marque « envoye » ;
     3. s il echoue quand meme, la commande garde la trace de l echec, le
        releve l affiche en rouge, et un bouton permet de le renvoyer.

   C est Stripe qui redige et envoie le recu : poser receipt_email sur le
   paiement suffit. Rien n est envoye tant que le client n a pas dit oui,
   et l envoi automatique de Stripe (Settings -> Emails) doit rester
   ferme, sinon tout le monde en recoit un.                               */

const STRIPE_BASE = 'https://api.stripe.com/v1';

function stripeKey() { return process.env.STRIPE_SECRET_KEY || ''; }

/* Deux essais : un incident reseau passager ne doit pas coûter le recu. */
async function putReceiptEmail(paymentIntentId, email) {
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${STRIPE_BASE}/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${stripeKey()}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: `receipt_email=${encodeURIComponent(email)}`,
      });
      if (r.ok) return { ok: true };
      const j = await r.json().catch(() => ({}));
      last = (j.error && j.error.message) || `stripe ${r.status}`;
      /* une erreur de requete ne s arrangera pas en reessayant */
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
    } catch (e) {
      last = (e && e.message) || 'network error';
    }
  }
  return { ok: false, error: last };
}

/* Stripe garde receipt_email sur le paiement : s il y est deja, le recu
   est parti. C est ce qui permet de rattraper les commandes d avant le
   suivi sans envoyer un deuxieme exemplaire a quelqu un qui l a deja. */
async function alreadySent(paymentIntentId) {
  if (!stripeKey() || !paymentIntentId) return null;
  try {
    const r = await fetch(`${STRIPE_BASE}/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
      headers: { authorization: `Bearer ${stripeKey()}` },
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j && j.receipt_email ? String(j.receipt_email) : '';
  } catch (e) { return null; }
}

/* Renvoie ce qu il faut inscrire sur la commande. */
async function sendReceipt(paymentIntentId, email) {
  if (!stripeKey()) return { receiptSent: false, receiptError: 'STRIPE_SECRET_KEY not set' };
  if (!paymentIntentId) return { receiptSent: false, receiptError: 'no payment on this order' };
  if (!email) return { receiptSent: false, receiptError: 'no email on this order' };
  const r = await putReceiptEmail(String(paymentIntentId), String(email));
  if (r.ok) return { receiptSent: true, receiptAt: new Date().toISOString(), receiptError: '' };
  console.error('receipt not sent to', email, '-', r.error);
  return { receiptSent: false, receiptError: r.error || 'unknown error' };
}

module.exports = { sendReceipt, alreadySent };

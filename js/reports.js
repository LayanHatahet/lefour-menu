/* Releve des commandes — Le Four
   Page separee du tableau de bord photos, et derriere son propre mot de
   passe : ces lignes portent le nom, le courriel et le telephone de vrais
   clients, alors que le tableau de bord sert aussi au personnel pour les
   photos et les prix. Deux usages, deux acces.

   Le mot de passe vient de REPORTS_PASSWORD, pose sur Vercel. Il n y a
   volontairement AUCUNE valeur de repli dans le code : le depot est
   public, et un mot de passe ecrit ici ne protegerait personne.        */
'use strict';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

let KEY = sessionStorage.getItem('lefour-reports') || '';
let MONTH = '';
let DATA = null;
let DAY = '';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const toast = (msg) => {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2600);
};

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(n) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return v.toFixed(2).replace('.', ',') + ' $';
}

async function api(path, opts) {
  const o = opts || {};
  const headers = { 'x-reports-key': KEY };
  if (o.body) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method: o.method || 'GET', body: o.body, headers, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/* Un recu demande et jamais parti doit sauter aux yeux : c est le seul
   cas ou la boulangerie a quelque chose a faire. */
function receiptBadge(o) {
  if (!o.receipt) return '';
  if (o.receiptSent) return '<span class="otag">receipt sent</span>';
  return '<span class="otag otag--bad">receipt NOT sent</span>' +
    '<button type="button" class="oresend" data-resend="' + esc(o.id || '') + '">Send it now</button>';
}

/* le mois de Montreal, pas celui du navigateur de qui regarde */
function thisMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const g = {};
  for (const x of parts) g[x.type] = x.value;
  return g.year + '-' + g.month;
}

function monthLabel(m) {
  const bits = String(m).split('-');
  return (MONTHS[Number(bits[1]) - 1] || m) + ' ' + bits[0];
}

async function loadMonths() {
  const sel = $('#ordMonth');
  let months = [];
  try {
    const j = await api('/api/orders');
    months = Array.isArray(j.months) ? j.months : [];
  } catch (e) {
    if (/unauthorized/i.test(e.message)) throw e;
  }
  const now = thisMonth();
  if (months.indexOf(now) === -1) months.unshift(now);
  sel.innerHTML = months.map(m =>
    '<option value="' + m + '">' + esc(monthLabel(m)) + '</option>').join('');
  MONTH = MONTH && months.indexOf(MONTH) > -1 ? MONTH : months[0];
  sel.value = MONTH;
}

async function loadMonth(month) {
  MONTH = month;
  DAY = '';
  $('#ordList').innerHTML = '<p class="muted">Loading…</p>';
  $('#ordCal').innerHTML = '';
  $('#ordStats').innerHTML = '';
  try {
    DATA = await api('/api/orders?month=' + encodeURIComponent(month));
  } catch (e) {
    DATA = null;
    $('#ordList').innerHTML = '<p class="muted">Could not load orders: ' + esc(e.message) + '</p>';
    return;
  }
  render();
}

function renderStats() {
  const t = (DATA && DATA.totals) || { count: 0, subtotal: 0, tps: 0, tvq: 0, total: 0 };
  $('#ordStats').innerHTML =
    '<div class="ostat"><b>' + t.count + '</b><span>orders</span></div>' +
    '<div class="ostat"><b>' + money(t.subtotal) + '</b><span>before tax</span></div>' +
    '<div class="ostat"><b>' + money(t.tps) + '</b><span>TPS collected</span></div>' +
    '<div class="ostat"><b>' + money(t.tvq) + '</b><span>TVQ collected</span></div>' +
    '<div class="ostat ostat--big"><b>' + money(t.total) + '</b><span>taken in</span></div>';
}

/* Une case par jour du mois. Les jours vides restent visibles : c est ce
   qui laisse lire le rythme de la semaine d un coup d oeil. */
function renderCal() {
  const host = $('#ordCal');
  if (!DATA) return;
  const bits = MONTH.split('-');
  const y = Number(bits[0]), m = Number(bits[1]);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  /* getUTCDay : 0 = dimanche. La semaine commence lundi dans un commerce. */
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const byDay = DATA.days || {};

  let cells = '';
  for (let i = 0; i < first; i++) cells += '<i class="ocell ocell--pad"></i>';
  for (let d = 1; d <= days; d++) {
    const key = MONTH + '-' + String(d).padStart(2, '0');
    const info = byDay[key];
    cells += '<button type="button" class="ocell' + (info ? ' has' : '') +
      (DAY === key ? ' is-on' : '') + '" data-oday="' + key + '"' +
      (info ? '' : ' disabled') + '>' +
      '<i>' + d + '</i>' +
      (info ? '<b>' + info.count + '</b><em>' + money(info.total) + '</em>' : '') +
      '</button>';
  }

  host.innerHTML =
    '<div class="ocal-head"><span>Mon</span><span>Tue</span><span>Wed</span>' +
    '<span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>' +
    '<div class="ocal-grid">' + cells + '</div>';

  $$('#ordCal [data-oday]').forEach(b => b.addEventListener('click', () => {
    DAY = DAY === b.dataset.oday ? '' : b.dataset.oday;
    render();
  }));
}

function card(o) {
  const items = (o.items || []).map(i =>
    '<li>' + i.qty + ' &times; ' + esc(i.name) + '<span>' + money(i.total) + '</span></li>').join('');
  const tax = (Number(o.tps) || 0) + (Number(o.tvq) || 0);
  return '<article class="ocard">' +
    '<header><span class="owhen">' + esc(o.day) + ' · ' + esc(o.time || '') + '</span>' +
    '<span class="oref">' + esc(o.ref || '') + '</span>' +
    (o.mode === 'test' ? '<span class="otest">test</span>' : '') + '</header>' +
    '<div class="owho">' +
      '<b>' + esc(o.name || '—') + '</b>' +
      (o.phone ? '<a href="tel:' + esc(o.phone) + '">' + esc(o.phone) + '</a>' : '') +
      (o.email ? '<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + '</a>' : '') +
      receiptBadge(o) +
    '</div>' +
    '<ul class="oitems">' + items + '</ul>' +
    (o.note ? '<p class="onote">“' + esc(o.note) + '”</p>' : '') +
    '<footer>' +
      (tax > 0 ? '<span>TPS ' + money(o.tps) + ' · TVQ ' + money(o.tvq) + '</span>' : '<span>no tax</span>') +
      '<b>' + money(o.total) + '</b>' +
    '</footer></article>';
}

function render() {
  if (!DATA) return;
  renderStats();
  renderCal();
  const all = DATA.orders || [];
  const shown = DAY ? all.filter(o => o.day === DAY) : all;
  const note = $('#ordFilter');
  note.hidden = !DAY;
  note.innerHTML = DAY
    ? 'Showing ' + shown.length + ' order' + (shown.length === 1 ? '' : 's') +
      ' from ' + esc(DAY) + ' — <button type="button" class="linkish" id="ordAll">show the whole month</button>'
    : '';
  const back = $('#ordAll');
  if (back) back.addEventListener('click', () => { DAY = ''; render(); });

  $('#ordList').innerHTML = shown.length
    ? shown.slice().reverse().map(card).join('')
    : '<p class="muted">No orders' + (DAY ? ' that day' : ' yet this month') +
      '. Card payments made on the website land here by themselves.</p>';

  $$('#ordList [data-resend]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const was = b.textContent;
    b.textContent = 'Sending…';
    try {
      const j = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ action: 'resend-receipt', month: MONTH, id: b.dataset.resend }),
      });
      toast('Receipt sent to ' + j.sentTo);
      await loadMonth(MONTH);
    } catch (e) {
      toast('Could not send: ' + e.message);
      b.disabled = false;
      b.textContent = was;
    }
  }));
}

/* Le fichier est protege par le mot de passe, qu un lien ordinaire ne peut
   pas porter : on le recupere par fetch puis on le remet au navigateur. */
async function downloadXlsx() {
  const btn = $('#ordXlsx');
  btn.disabled = true;
  try {
    const r = await fetch('/api/orders?format=xlsx&month=' + encodeURIComponent(MONTH), {
      headers: { 'x-reports-key': KEY },
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || ('HTTP ' + r.status));
    }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'le-four-commandes-' + MONTH + '.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Excel file downloaded');
  } catch (e) {
    toast('Error: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

function showApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#logout').hidden = false;
}

async function start() {
  await loadMonths();
  await loadMonth(MONTH);
}

$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  KEY = $('#pw').value;
  const err = $('#gateErr');
  err.hidden = true;
  try {
    await api('/api/orders');
    sessionStorage.setItem('lefour-reports', KEY);
    showApp();
    await start();
  } catch (e2) {
    if (/unauthorized/i.test(e2.message)) {
      err.textContent = 'Incorrect password.';
      err.hidden = false;
      return;
    }
    if (/not configured/i.test(e2.message)) {
      err.innerHTML = 'No reports password has been set yet. Add <code>REPORTS_PASSWORD</code> ' +
        'in Vercel → the <code>lefour</code> project → Settings → Environment Variables, then redeploy.';
      err.hidden = false;
      return;
    }
    /* toute autre panne : la cle peut etre bonne, on laisse entrer et on
       affichera l erreur reelle a l interieur */
    sessionStorage.setItem('lefour-reports', KEY);
    showApp();
    try { await start(); } catch (e3) { toast('Error: ' + e3.message); }
  }
});

$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem('lefour-reports');
  location.reload();
});

$('#ordMonth').addEventListener('change', (e) => loadMonth(e.target.value));
$('#ordRefresh').addEventListener('click', () => loadMonth(MONTH));
$('#ordXlsx').addEventListener('click', downloadXlsx);

if (KEY) {
  showApp();
  start().catch(e => {
    if (/unauthorized/i.test(e.message)) {
      sessionStorage.removeItem('lefour-reports');
      location.reload();
      return;
    }
    toast('Error: ' + e.message);
  });
}

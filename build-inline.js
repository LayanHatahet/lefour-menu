/* Build step, run against the staged `public/` folder.
   1. Inlines style.css into index.html so the first paint needs no extra round trip.
   2. Emits real per-language documents at /en/ and /ar/ so that search engines
      receive lang, dir, title, description and canonical for the right language
      on the very first byte — not after JavaScript runs.                        */
const fs = require('fs');
const out = process.argv[2] || 'public';

const htmlPath = `${out}/index.html`;
let html = fs.readFileSync(htmlPath, 'utf8');

/* ── 1. inline the stylesheet ─────────────────────────────── */
const css = fs.readFileSync(`${out}/css/style.css`, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/url\((['"]?)\.\.\/assets\//g, 'url($1/assets/')
  .replace(/\s*\n\s*/g, '\n')
  .replace(/\n{2,}/g, '\n')
  .trim();

const link = '<link rel="stylesheet" href="css/style.css">';
if (html.includes(link)) {
  html = html.replace(link, () => `<style>${css}</style>`);
  console.log(`inlined ${(css.length / 1024).toFixed(1)}KB of CSS`);
} else {
  console.error('style.css link not found — inline skipped');
}

/* ── 1b. inline the two menu scripts ──────────────────────
   As external files they downloaded after the first paint, so the 35-card
   menu appeared late and pushed every section below it down (desktop CLS
   ~0.30). Inlined, they run while the document is parsed and the menu is
   already laid out when the page is first painted.                        */
for (const f of ['js/data.js', 'js/main.js']) {
  const tag = `<script src="${f}"></script>`;
  if (!html.includes(tag)) { console.error(`${f} tag not found — left external`); continue; }
  const code = fs.readFileSync(`${out}/${f}`, 'utf8');
  if (/<\/script/i.test(code)) { console.error(`${f} contains </script — left external`); continue; }
  html = html.replace(tag, () => `<script>
${code}
</script>`);
  console.log(`inlined ${(code.length / 1024).toFixed(1)}KB from ${f}`);
}
/* index.html is written further down, once the Menu structured data exists. */

/* ── 2. per-language documents ────────────────────────────── */
const SITE = 'https://lefourboulangerie.com';

const META = {
  en: {
    dir: 'ltr',
    locale: 'en_CA',
    title: 'Le Four — Lebanese & Syrian Bakery in Pierrefonds | Halal Manakish & Catering',
    desc: 'Boulangerie Le Four in Pierrefonds (West Island, Montreal): manakish, fatayer, bites and mezze, 100% halal, baked fresh every morning. Delivery, pickup and catering.',
    ogTitle: 'Le Four — Lebanese & Syrian Bakery in Pierrefonds',
    ogDesc: 'Manakish, fatayer and bites, 100% halal, baked fresh every morning. Delivery, pickup and catering.',
    imgAlt: 'Boulangerie Le Four — Pierrefonds, West Island',
  },
  ar: {
    dir: 'rtl',
    locale: 'ar_AR',
    title: 'لو فور — مخبز لبناني سوري في بييرفون | مناقيش وكاترينغ حلال',
    desc: 'مخبز لو فور في بييرفون (ويست آيلاند، مونتريال): مناقيش وفطائر ولقيمات ومقبلات، 100٪ حلال، تُخبز طازجة كل صباح. توصيل واستلام وخدمة كاترينغ.',
    ogTitle: 'لو فور — مخبز لبناني سوري في بييرفون',
    ogDesc: 'مناقيش وفطائر ولقيمات، 100٪ حلال، تُخبز طازجة كل صباح. توصيل واستلام وكاترينغ.',
    imgAlt: 'مخبز لو فور — بييرفون، ويست آيلاند',
  },
};

/* the runtime dictionary and the menu itself, so the per-language documents ship
   translated copy — and the Menu structured data — in the very first byte
   instead of French text swapped out by JavaScript on load */
const DATA = (() => {
  try {
    const src = fs.readFileSync(`${out}/js/data.js`, 'utf8');
    return new Function(src + ';\nreturn { UI, MENU };')();
  } catch (e) {
    console.error('menu data unavailable - copy left in French:', e.message);
    return {};
  }
})();
const UI = DATA.UI || null;
const MENU = DATA.MENU || null;

const escHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── 2b. Menu structured data ─────────────────────────────────
   The client's menu sheet gives every product a description, a stable address
   and a keyword. Emitting them as schema.org/Menu lets Google show the dishes
   and prices directly in search, and it is generated per language from the same
   data.js the page renders from, so the two can never drift apart.
   Pizzas are left out on purpose: they are hidden on the site, and marking up
   items a visitor cannot see is exactly what Google penalises.               */
const SECTIONS = [
  ['manakish', 'manakishTitle'],
  ['minis', 'minisTitle'],
  ['mezze', 'mezzeTitle'],
  ['drinks', 'drinksTitle'],
];
const DIET = { veg: 'https://schema.org/VegetarianDiet' };

function menuLd(lng, base) {
  if (!MENU || !UI || !UI[lng]) return null;
  const dict = UI[lng];
  const sections = [];
  for (const [key, titleKey] of SECTIONS) {
    const items = (MENU[key] || []).map((it) => {
      const node = {
        '@type': 'MenuItem',
        name: (it.name && it.name[lng]) || it.id,
      };
      if (it.desc && it.desc[lng]) node.description = it.desc[lng];
      if (it.seo && it.seo.slug) node.url = `${base}/menu/${it.seo.slug}`;
      if (it.price != null) {
        node.offers = { '@type': 'Offer', price: it.price.toFixed(2), priceCurrency: 'CAD' };
      }
      if (it.tags && it.tags.includes('veg')) node.suitableForDiet = DIET.veg;
      return node;
    });
    if (items.length) {
      sections.push({ '@type': 'MenuSection', name: dict[titleKey] || key, hasMenuItem: items });
    }
  }
  if (!sections.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    '@id': `${SITE}/#menu`,
    name: dict.carteTitle || 'Menu',
    inLanguage: lng === 'fr' ? 'fr-CA' : lng === 'en' ? 'en-CA' : 'ar',
    url: base + '/',
    provider: { '@id': `${SITE}/#business` },
    hasMenuSection: sections,
  };
}

/* `<` is escaped so a description could never close the script element early */
function injectMenuLd(doc, lng, base) {
  const ld = menuLd(lng, base);
  if (!ld) { console.error(`  ${lng}: Menu structured data skipped`); return doc; }
  const json = JSON.stringify(ld).replace(/</g, '\\u003c');
  const n = ld.hasMenuSection.reduce((a, s) => a + s.hasMenuItem.length, 0);
  console.log(`  ${lng}: Menu structured data — ${ld.hasMenuSection.length} sections, ${n} items`);
  return doc.replace('</head>', () =>
    `  <script type="application/ld+json" id="ldMenu">${json}</script>\n</head>`);
}

const I18N_RE = /(<([a-zA-Z0-9]+)\b[^>]*\bdata-i18n="([A-Za-z0-9_]+)"[^>]*>)([^<]*)(<\/\2>)/g;

/* <span data-i18n="key">texte francais</span> -> the same node in `lng`.
   Mirrors applyI18n(), which sets el.textContent = t(key) at runtime, so the
   two can never disagree; every data-i18n element holds plain text only. */
function translate(doc, lng) {
  const dict = UI && UI[lng];
  if (!dict) return doc;
  let hit = 0, miss = 0;
  const outDoc = doc.replace(I18N_RE, (m, open, tag, key, _inner, close) => {
    const v = dict[key];
    if (v == null) { miss++; return m; }
    hit++;
    return open + escHtml(v) + close;
  });
  console.log(`  ${lng}: translated ${hit} nodes` + (miss ? `, ${miss} key(s) missing` : ''));
  return outDoc;
}

/* replace the first attribute match inside a given tag */
function setAttr(doc, tagRe, attr, value) {
  return doc.replace(tagRe, (tag) => {
    const re = new RegExp(`(${attr}=")[^"]*(")`);
    return re.test(tag) ? tag.replace(re, `$1${value}$2`) : tag;
  });
}

for (const [lng, m] of Object.entries(META)) {
  let doc = html;

  /* the document itself */
  doc = doc.replace('<html lang="fr" dir="ltr">', `<html lang="${lng}" dir="${m.dir}">`);
  doc = doc.replace(/<title>[\s\S]*?<\/title>/, `<title>${m.title}</title>`);
  doc = setAttr(doc, /<meta name="description"[^>]*>/, 'content', m.desc);
  doc = setAttr(doc, /<link rel="canonical"[^>]*>/, 'href', `${SITE}/${lng}`);
  doc = setAttr(doc, /<meta property="og:url"[^>]*>/, 'content', `${SITE}/${lng}`);
  doc = setAttr(doc, /<meta property="og:locale"[^>]*>/, 'content', m.locale);
  doc = setAttr(doc, /<meta property="og:title"[^>]*>/, 'content', m.ogTitle);
  doc = setAttr(doc, /<meta property="og:description"[^>]*>/, 'content', m.ogDesc);
  doc = setAttr(doc, /<meta property="og:image:alt"[^>]*>/, 'content', m.imgAlt);
  doc = setAttr(doc, /<meta name="twitter:title"[^>]*>/, 'content', m.ogTitle);
  doc = setAttr(doc, /<meta name="twitter:description"[^>]*>/, 'content', m.ogDesc);

  /* tell the runtime which language this document was built for */
  doc = doc.replace('<body data-lang="fr">', `<body data-lang="${lng}" data-lang-locked="1">`);

  /* and the visible copy, so /en and /ar are not French pages repainted by JS */
  doc = translate(doc, lng);
  doc = injectMenuLd(doc, lng, `${SITE}/${lng}`);

  /* the document now lives one level deep -> make every asset path absolute */
  doc = doc.replace(/(src|href)="(assets\/|js\/|css\/)/g, '$1="/$2');

  fs.mkdirSync(`${out}/${lng}`, { recursive: true });
  fs.writeFileSync(`${out}/${lng}/index.html`, doc);
  console.log(`wrote /${lng}/index.html  (lang=${lng} dir=${m.dir})`);
}

/* the French document is the root; /fr is the same page, just addressable */
const frDoc = injectMenuLd(html, 'fr', SITE);
fs.writeFileSync(htmlPath, frDoc);
console.log('wrote /index.html');

fs.mkdirSync(`${out}/fr`, { recursive: true });
fs.writeFileSync(`${out}/fr/index.html`,
  frDoc.replace(/(src|href)="(assets\/|js\/|css\/)/g, (m, a, p) => `${a}="/${p}`));
console.log('wrote /fr/index.html');

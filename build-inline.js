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
fs.writeFileSync(htmlPath, html);

/* ── 2. per-language documents ────────────────────────────── */
const SITE = 'https://lefour.vercel.app';

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

  /* the document now lives one level deep -> make every asset path absolute */
  doc = doc.replace(/(src|href)="(assets\/|js\/|css\/)/g, '$1="/$2');

  fs.mkdirSync(`${out}/${lng}`, { recursive: true });
  fs.writeFileSync(`${out}/${lng}/index.html`, doc);
  console.log(`wrote /${lng}/index.html  (lang=${lng} dir=${m.dir})`);
}

/* /fr is the same document as the root, just addressable */
fs.mkdirSync(`${out}/fr`, { recursive: true });
fs.writeFileSync(`${out}/fr/index.html`,
  html.replace(/(src|href)="(assets\/|js\/|css\/)/g, '$1="/$2')
      .replace('<link rel="canonical" href="https://lefour.vercel.app/">',
               '<link rel="canonical" href="https://lefour.vercel.app/">'));
console.log('wrote /fr/index.html');

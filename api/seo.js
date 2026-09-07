/* Serves robots.txt and sitemap.xml using the domain actually being requested,
   so nothing has to change when the custom domain goes live.
   /robots.txt  -> /api/seo?f=robots
   /sitemap.xml -> /api/seo?f=sitemap                                        */

module.exports = (req, res) => {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'lefour.vercel.app';
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const base = `${proto}://${host}`;
  const which = (req.query && req.query.f) || 'robots';

  res.setHeader('cache-control', 'public, max-age=3600');

  if (which === 'sitemap') {
    /* Une langue = un document servi (/, /en, /ar), avec ses propres lang, dir,
       title et canonical. Chaque version doit annoncer toutes les autres :
       sans reciprocite, Google ignore le groupe hreflang au complet. */
    const LANGS = [['fr-CA', '/'], ['en-CA', '/en'], ['ar', '/ar']];
    const alternates =
      LANGS.map(([h, p]) => `\n    <xhtml:link rel="alternate" hreflang="${h}" href="${base}${p}"/>`).join('')
      + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${base}/"/>`;

    const pages = ['/', '/en', '/ar', '/menu', '/traiteur', '/contact'];
    const isLang = (p) => LANGS.some(([, lp]) => lp === p);
    const urls = pages.map(p =>
      `  <url>\n    <loc>${base}${p}</loc>\n    <changefreq>weekly</changefreq>` +
      `\n    <priority>${p === '/' ? '1.0' : '0.8'}</priority>` +
      `${isLang(p) ? alternates : ''}\n  </url>`).join('\n');

    res.setHeader('content-type', 'application/xml; charset=utf-8');
    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
      `${urls}\n</urlset>\n`);
  }

  res.setHeader('content-type', 'text/plain; charset=utf-8');
  return res.status(200).send(
    `# Boulangerie Le Four\nUser-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin.html\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`);
};

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
    const pages = ['/', '/menu', '/traiteur', '/contact'];
    const urls = pages.map(p => {
      const alt = p === '/'
        ? ['fr-CA', 'en-CA', 'ar'].map(h =>
            `\n    <xhtml:link rel="alternate" hreflang="${h}" href="${base}/?lang=${h.split('-')[0]}"/>`).join('')
          + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${base}/"/>`
        : '';
      return `  <url>\n    <loc>${base}${p}</loc>\n    <changefreq>weekly</changefreq>` +
             `\n    <priority>${p === '/' ? '1.0' : '0.8'}</priority>${alt}\n  </url>`;
    }).join('\n');
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

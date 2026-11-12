import { createFileRoute } from '@tanstack/react-router';
import { allTools } from '~/data/tools';
import { SITE_URL } from '~/utils/seo';

const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[char]!
  );

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: () => {
        const paths = new Set([
          '/',
          ...allTools.map((tool) => `/tools/${tool.slug}`),
        ]);
        const entries = [...paths]
          .map(
            (path) => `<url><loc>${escapeXml(`${SITE_URL}${path}`)}</loc></url>`
          )
          .join('');
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`,
          { headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
        );
      },
    },
  },
});

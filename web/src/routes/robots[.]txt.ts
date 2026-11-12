import { createFileRoute } from '@tanstack/react-router';
import { SITE_URL } from '~/utils/seo';

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: () =>
        new Response(
          `User-agent: *\nAllow: /\nDisallow: /_shell.html\nSitemap: ${SITE_URL}/sitemap.xml\n`,
          { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        ),
    },
  },
});

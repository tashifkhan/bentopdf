import { FadeUp } from '~/components/Motion';

/**
 * Credits for the upstream project this UI is built on, mirroring the sponsor
 * block in alam00000/bentopdf's README (Vercel, DigitalOcean, NVIDIA, Vultr).
 */

const SPONSORS = [
  {
    name: 'Vercel OSS Program',
    href: 'https://vercel.com/open-source-program',
  },
  { name: 'DigitalOcean', href: 'https://www.digitalocean.com/' },
  { name: 'NVIDIA Inception', href: 'https://www.nvidia.com/en-us/startups/' },
] as const;

const linkClass =
  'inline-flex h-9 items-center rounded-[0.7rem] border border-border bg-secondary px-3 text-sm font-semibold text-foreground transition-colors hover:border-brand/40';

export function UpstreamCredits() {
  return (
    <FadeUp className="surface-card mt-10 p-4 sm:mt-12 sm:p-5">
      <section aria-labelledby="upstream-credits-title">
        <h2 id="upstream-credits-title" className="section-title">
          Built on BentoPDF
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          This is a UI fork of{' '}
          <a
            href="https://github.com/alam00000/bentopdf"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent hover:underline"
          >
            alam00000/bentopdf
          </a>
          , licensed AGPL-3.0-only. Thanks to the organisations that sponsor the
          upstream project.
        </p>

        <ul
          className="mt-4 flex flex-wrap items-center gap-2"
          aria-label="Upstream sponsors"
        >
          {SPONSORS.map((s) => (
            <li key={s.name}>
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                {s.name}
              </a>
            </li>
          ))}
          <li>
            <a
              href="https://www.vultr.com/"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
              aria-label="Vultr"
            >
              <img
                src="/images/vultr-logo-light.svg"
                alt=""
                height={18}
                className="h-[18px] w-auto dark:hidden"
              />
              <img
                src="/images/vultr-logo-dark.svg"
                alt=""
                height={18}
                className="hidden h-[18px] w-auto dark:block"
              />
            </a>
          </li>
        </ul>

        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a
            href="https://github.com/sponsors/alam00000"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent hover:underline"
          >
            Become a sponsor
          </a>
          <a
            href="https://ko-fi.com/alio01"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent hover:underline"
          >
            Buy the author a coffee
          </a>
        </p>
      </section>
    </FadeUp>
  );
}

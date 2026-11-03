import { Link, useLocation, useRouter } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { StatusPanel, statusButton } from '~/components/StatusPanel';

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();
  const isRoot = useLocation({
    select: (location) => location.pathname === '/',
  });

  console.error('DefaultCatchBoundary Error:', error);

  const message = error instanceof Error ? error.message : String(error);

  return (
    <StatusPanel
      code="Error"
      tone="danger"
      title="Something went wrong"
      actions={
        <>
          <button
            type="button"
            onClick={() => {
              void router.invalidate();
            }}
            className={statusButton.primary}
          >
            Try again
          </button>
          {isRoot ? null : (
            <Link to="/" className={statusButton.secondary}>
              All tools
            </Link>
          )}
        </>
      }
    >
      <p>
        Your files were not uploaded anywhere. Reloading usually fixes this.
      </p>
      {message ? (
        <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-border bg-secondary p-3 text-left text-xs text-ink-2 whitespace-pre-wrap">
          {message}
        </pre>
      ) : null}
    </StatusPanel>
  );
}

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { StatusPanel, statusButton } from '~/components/StatusPanel';

export function NotFound({ children }: { children?: ReactNode }) {
  return (
    <StatusPanel
      code="404"
      title="Page not found"
      actions={
        <>
          <Link to="/" className={statusButton.primary}>
            Browse all tools
          </Link>
          <button
            type="button"
            onClick={() => window.history.back()}
            className={statusButton.secondary}
          >
            Go back
          </button>
        </>
      }
    >
      {children || (
        <p>
          That link doesn't match any page or tool. It may have been renamed.
        </p>
      )}
    </StatusPanel>
  );
}

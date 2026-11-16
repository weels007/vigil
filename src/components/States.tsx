import type { ReactNode } from 'react';

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        ◌
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Loader({ label = 'Reading the ledger…' }: { label?: string }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <span className="loader-eye" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success';
  children: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <span className="error-mark" aria-hidden="true">
        !
      </span>
      <div>
        <h3>The ledger could not be read</h3>
        <p>{message}</p>
        {onRetry ? (
          <button type="button" className="btn btn-ghost btn-small" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

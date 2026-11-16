const LABELS: Record<string, string> = {
  ACTIVE: 'Watching',
  TRIGGERED: 'Unlocked',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

export function StateBadge({ state }: { state: string }) {
  const key = state.toLowerCase();
  return <span className={`badge badge-${key}`}>{LABELS[state] ?? state}</span>;
}

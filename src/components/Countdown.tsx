import { useEffect, useState } from 'react';

import { countdown } from '../lib/format';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function Countdown({ deadline, className = '' }: { deadline: number; className?: string }) {
  const now = useNow();
  const value = countdown(deadline, now);
  return (
    <span className={`countdown ${value.expired ? 'is-expired' : ''} ${className}`.trim()}>{value.text}</span>
  );
}

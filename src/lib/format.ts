const WEI = 10n ** 18n;

export function formatGen(wei: bigint): string {
  const negative = wei < 0n;
  const value = negative ? -wei : wei;
  const whole = value / WEI;
  const fraction = value % WEI;
  const scaled = (fraction * 10000n) / WEI;
  let text = whole.toString();
  if (scaled > 0n) {
    const trimmed = scaled.toString().padStart(4, '0').replace(/0+$/, '');
    text = `${text}.${trimmed}`;
  }
  return negative ? `-${text}` : text;
}

export function parseGen(text: string): bigint {
  const clean = text.trim();
  if (clean === '' || clean === '.' || !/^\d*(\.\d*)?$/.test(clean)) {
    throw new Error('Enter a GEN amount, for example 0.01.');
  }
  const [whole = '', fraction = ''] = clean.split('.');
  if (fraction.length > 18) {
    throw new Error('GEN supports at most 18 decimals.');
  }
  const padded = (fraction + '0'.repeat(18)).slice(0, 18);
  return BigInt((whole || '0') + padded);
}

export function shortAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function toWei(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatDateTime(unix: number): string {
  if (!unix || unix <= 0) return '—';
  return new Date(unix * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(unix: number): string {
  if (!unix || unix <= 0) return '—';
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function relativeTime(unix: number): string {
  if (!unix || unix <= 0) return '—';
  const seconds = Math.floor(Date.now() / 1000) - unix;
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export interface Countdown {
  expired: boolean;
  text: string;
}

export function countdown(deadline: number, now: number): Countdown {
  const seconds = deadline - now;
  if (seconds <= 0) return { expired: true, text: 'Deadline passed' };
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const clock = [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':');
  return { expired: false, text: days > 0 ? `${days}d ${clock}` : clock };
}

export function toUnix(dateInput: string): number {
  const parsed = new Date(dateInput).getTime();
  if (Number.isNaN(parsed)) {
    throw new Error('Pick a deadline date and time.');
  }
  return Math.floor(parsed / 1000);
}

export function datetimeLocalValue(unix: number): string {
  const date = new Date(unix * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

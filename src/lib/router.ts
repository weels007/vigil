import { useEffect, useState } from 'react';

export interface Route {
  path: string;
  parts: string[];
}

function readHash(): string {
  if (typeof window === 'undefined') return '/';
  const raw = window.location.hash.replace(/^#/, '');
  return raw === '' ? '/' : raw;
}

export function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
}

export function useHashRoute(): Route {
  const [path, setPath] = useState<string>(readHash);

  useEffect(() => {
    const onChange = () => setPath(readHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [path]);

  return {
    path,
    parts: path.split('/').filter(Boolean),
  };
}

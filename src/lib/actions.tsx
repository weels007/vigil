import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface ActionsApi {
  pending: Record<string, boolean>;
  isPending: (key: string) => boolean;
  run: <T>(key: string, task: () => Promise<T>) => Promise<T>;
}

const ActionsContext = createContext<ActionsApi | null>(null);

export function ActionsProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const busy = useRef<Record<string, boolean>>({});

  const run = useCallback(async <T,>(key: string, task: () => Promise<T>): Promise<T> => {
    if (busy.current[key]) {
      throw new Error('This action is already running.');
    }
    busy.current[key] = true;
    setPending((previous) => ({ ...previous, [key]: true }));
    try {
      return await task();
    } finally {
      delete busy.current[key];
      setPending((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  }, []);

  const isPending = useCallback((key: string) => pending[key] === true, [pending]);

  const value = useMemo<ActionsApi>(() => ({ pending, isPending, run }), [pending, isPending, run]);

  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}

export function useActions(): ActionsApi {
  const context = useContext(ActionsContext);
  if (!context) throw new Error('useActions must be used inside ActionsProvider');
  return context;
}

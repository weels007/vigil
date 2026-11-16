import { useCallback, useEffect, useRef, useState } from 'react';

import { translateError } from './errors';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export interface AsyncResult<T> extends AsyncState<T> {
  reload: () => void;
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setState((previous) => ({ data: previous.data, error: null, loading: true }));
    loaderRef
      .current()
      .then((data) => {
        if (alive) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (alive) setState({ data: null, error: translateError(error), loading: false });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  return { ...state, reload };
}

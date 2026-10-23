import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';

// Loads a GET path and re-loads when the path changes. Pass null to skip loading.
export function useApi<T>(path: string | null): { data: T | null; error: string; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (path === null) {
      setData(null);
      setError('');
      return;
    }
    let cancelled = false;
    setData(null);
    setError('');
    api<T>(path)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { data, error, loading: path !== null && data === null && error === '' };
}
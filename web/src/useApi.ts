import { useEffect, useState } from 'react';
import { api } from './api.ts';

// Loads JSON from the API whenever `path` or `reloadKey` changes, tracking loading and errors.
export function useApi<T>(path: string, reloadKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false; // set when this request is out of date
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((result) => {
        if (!ignore) setData(result);
      })
      .catch((err: Error) => {
        if (!ignore) setError(err);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [path, reloadKey]);

  return { data, error, loading };
}

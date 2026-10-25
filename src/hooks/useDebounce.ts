import { useState, useEffect } from 'react';

/**
 * Custom hook to debounce any rapidly changing value by a specified delay (default 350ms).
 * Useful for search inputs, filter inputs, and auto-saving textareas to prevent excessive API requests.
 */
export function useDebounce<T>(value: T, delay: number = 350): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export default useDebounce;

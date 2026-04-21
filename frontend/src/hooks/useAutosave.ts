"use client";

import { useRef, useCallback, useEffect } from "react";

/**
 * Debounced autosave hook. Calls `saveFn` after `delay` ms of inactivity.
 * Returns a `trigger()` function to signal a change.
 */
export function useAutosave(saveFn: () => Promise<void>, delay = 800) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;

  const trigger = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveFnRef.current().catch(() => {});
    }, delay);
  }, [delay]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        saveFnRef.current().catch(() => {});
      }
    };
  }, []);

  return trigger;
}

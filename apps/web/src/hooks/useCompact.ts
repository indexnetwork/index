import { useSyncExternalStore } from "react";

/** Phones and narrow tablets: one full-screen window, bottom tab bar. Keep in sync with workbench.css. */
export const COMPACT_QUERY = "(max-width: 720px)";
/** Below this the signal page drops to two panes. */
export const MEDIUM_QUERY = "(max-width: 1100px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

export function useCompact(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}

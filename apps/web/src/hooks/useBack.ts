import { useCallback } from "react";
import { useNavigate } from "react-router";

/** Fallback of every back box this hook made, so the titlebar can tell where it lands. */
const fallbacks = new WeakMap<() => void, string>();

/** True when this screen opened the tab (deep link, fresh tab): there is no app history behind it. */
export function atHistoryEntry(): boolean {
  return ((window.history.state as { idx?: number } | null)?.idx ?? 0) === 0;
}

/** True when `onClose` is a back box that would land on home, because nothing in the app is behind it. */
export function backLandsHome(onClose: (() => void) | undefined): boolean {
  return !!onClose && fallbacks.get(onClose) === "/" && atHistoryEntry();
}

/**
 * A back box for drill-in screens: pops history when the app pushed this
 * screen, otherwise (deep link, fresh tab) replaces it with `fallback`.
 */
export function useBack(fallback: string): () => void {
  const navigate = useNavigate();
  const back = useCallback(() => {
    if (!atHistoryEntry()) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
  fallbacks.set(back, fallback);
  return back;
}

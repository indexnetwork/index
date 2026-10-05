import { useCallback } from "react";
import { useNavigate } from "react-router";

/**
 * A back box for drill-in screens: pops history when the app pushed this
 * screen, otherwise (deep link, fresh tab) replaces it with `fallback`.
 */
export function useBack(fallback: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}

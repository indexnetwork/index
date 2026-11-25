import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** How long an action waits for "undo" before it's sent. */
const UNDO_MS = 5_000;

interface Pending { id: number; text: string; undo?: () => void; commit: () => void }

const UndoContext = createContext<(text: string, commit: () => void, undo?: () => void) => void>((_text, commit) => commit());

/**
 * Pass, skip, answer and archive wait a few seconds behind a toast with
 * "undo" before they reach the server. A new action sends the waiting one at once.
 */
export function UndoProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<Pending | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = current.current;
    current.current = null;
    setPending(null);
    p?.commit();
  }, []);

  const schedule = useCallback((text: string, commit: () => void, undo?: () => void) => {
    flush();
    const p = { id: Date.now(), text, commit, undo };
    current.current = p;
    setPending(p);
    timer.current = setTimeout(flush, UNDO_MS);
  }, [flush]);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = current.current;
    current.current = null;
    setPending(null);
    p?.undo?.();
  };

  // Leaving the app sends what's waiting rather than dropping it.
  useEffect(() => {
    const onHide = () => { if (current.current) flush(); };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flush]);

  return (
    <UndoContext.Provider value={schedule}>
      {children}
      {pending && (
        <div className="sv-toast" role="status" key={pending.id}>
          <span>{pending.text}</span>
          {pending.undo && <button type="button" onClick={cancel}>undo</button>}
        </div>
      )}
    </UndoContext.Provider>
  );
}

/** @returns `later(text, commit, undo)`: shows the toast and sends after a few seconds unless undone. */
export function useUndo() {
  return useContext(UndoContext);
}

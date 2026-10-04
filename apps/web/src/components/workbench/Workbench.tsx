import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { useCompact } from "@/hooks/useCompact";

const windowStack: Array<{ get: () => (() => void) | undefined }> = [];
let escapeBound = false;

function bindEscape() {
  if (escapeBound || typeof document === "undefined") return;
  escapeBound = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
      el.blur();
      return;
    }
    for (let i = windowStack.length - 1; i >= 0; i--) {
      const close = windowStack[i].get();
      if (close) {
        e.preventDefault();
        close();
        return;
      }
    }
  });
}

export function Stage({
  children,
  width = 980,
  height,
}: {
  children: ReactNode;
  width?: number | string;
  height?: string;
}) {
  const compact = useCompact();
  // Compact: the window is the screen, so the desktop sizing drops away.
  if (compact) {
    return (
      <div className="wb-stage">
        <div style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="wb-stage">
      <div style={{ width, maxWidth: "100%", height, minWidth: 0, maxHeight: "calc(100vh - 112px)" }}>
        {children}
      </div>
    </div>
  );
}

export function Window({
  title,
  onClose,
  dismiss = false,
  children,
  style,
}: {
  title: string;
  onClose?: () => void;
  dismiss?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const compact = useCompact();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    bindEscape();
    const entry = { get: () => closeRef.current };
    windowStack.push(entry);
    return () => {
      const i = windowStack.indexOf(entry);
      if (i !== -1) windowStack.splice(i, 1);
    };
  }, []);

  return (
    <div className="amiga-window" style={{ height: "100%", ...style }}>
      <div className="mac-titlebar">
        {/* Compact: the close box reads as back, and tab roots (no onClose) drop it. */}
        {compact && !onClose ? null : <span
          className={compact ? "mac-close mac-back" : dismiss ? "mac-close mac-dismiss" : "mac-close"}
          role="button"
          tabIndex={0}
          title={compact ? "back" : dismiss ? "put away" : "close"}
          aria-label={compact ? "back" : dismiss ? "put away" : "close"}
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClose?.();
            }
          }}
        />}
        <span className="mac-title"><span className="t">{title}</span></span>
      </div>
      <div className="wb-body">{children}</div>
    </div>
  );
}

export function RuleLabel({ children, size = 10 }: { children: ReactNode; size?: number }) {
  return (
    <div className="wb-rule" style={{ fontSize: size, letterSpacing: size >= 12 ? 1.4 : 2 }}>
      <span>{children}</span>
      <span />
    </div>
  );
}

export function Btn({
  children,
  onClick,
  primary = false,
  small = false,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  small?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`wb-btn${primary ? " primary" : ""}${small ? " small" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function QCount({ n, title }: { n: number; title?: string }) {
  if (!n) return null;
  return (
    <span className="wb-count" title={title || `${n} waiting on you: pending opportunities`}>
      {n}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  size?: "lg";
}) {
  return (
    <div className={`wb-segmented${size === "lg" ? " lg" : ""}`} role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ConfirmWindow({
  title,
  body,
  confirmLabel,
  busy,
  disabled,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 110, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", placeItems: "center", background: "rgba(0,85,170,0.28)", padding: 24 }}>
      <div className="amiga-window" style={{ width: 420, maxWidth: "100%" }}>
        <div className="mac-titlebar">
          <span className="mac-title"><span className="t">{title}</span></span>
        </div>
        <div className="wb-body" style={{ padding: 18, gap: 12 }}>
          <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13 }}>{body}</p>
          {children}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="wb-btn" disabled={busy} onClick={onCancel}>cancel</button>
            <button type="button" className="wb-btn primary" disabled={busy || disabled} onClick={onConfirm}>
              {busy ? `${confirmLabel}…` : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

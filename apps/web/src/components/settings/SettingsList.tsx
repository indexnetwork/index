import { useState, type ReactNode } from "react";

/** Remove, revoke: a red-text box that asks once more before it acts. */
export function ConfirmButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      onBlur={() => setArmed(false)}
      disabled={disabled}
      className={`wb-btn danger${armed ? " on" : ""}`}
    >{armed ? "confirm" : label}</button>
  );
}

/** One row of a settings list: the name over a mono detail line, its action on the right. */
export function SettingsItem({ name, tag, detail, action }: { name: string; tag?: ReactNode; detail: string; action?: ReactNode }) {
  return (
    <li className="st-item">
      <span className="st-item-text">
        <span className="st-item-head">
          <span className="st-name">{name}</span>
          {tag && <span className="st-tag">{tag}</span>}
        </span>
        <span className="st-detail">{detail}</span>
      </span>
      {action}
    </li>
  );
}

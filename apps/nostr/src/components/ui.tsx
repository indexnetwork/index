import { npub } from '@indexnetwork/nostr';
import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export type Names = Record<string, string>;

/** A short, human label for a key: a known name, or the start of its npub. */
export function who(pubkey: string | null | undefined, names: Names): string {
  if (!pubkey) return 'someone';
  return names[pubkey] ?? `${npub(pubkey).slice(0, 12)}…`;
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
      onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {label}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">{children}</div>;
}

export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {hint && <p className="text-sm text-neutral-500">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const VISIBILITY_STYLE: Record<string, string> = {
  public: 'bg-emerald-50 text-emerald-700',
  network_only: 'bg-sky-50 text-sky-700',
  incognito: 'bg-violet-50 text-violet-700',
  private: 'bg-neutral-100 text-neutral-600',
};

export function VisibilityChip({ visibility }: { visibility: string }) {
  return <span className={`chip ${VISIBILITY_STYLE[visibility] ?? ''}`}>{visibility.replace('_', '-')}</span>;
}

export function KindChip({ kind }: { kind: number }) {
  return <span className="chip bg-neutral-100 font-mono text-neutral-600">kind {kind}</span>;
}

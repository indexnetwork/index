import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

function hasActiveSelection(): boolean {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  return !!sel && !sel.isCollapsed && sel.toString().length > 0;
}

export default function CopyableBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (hasActiveSelection()) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 800);
    } catch {
      /* silent */
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy"
      className={`relative w-full text-left group rounded-sm border p-3 transition-colors duration-300 ${
        copied
          ? 'bg-green-100 border-green-400'
          : 'bg-gray-50 border-gray-200 hover:bg-green-50 hover:border-green-300'
      }`}
    >
      <code className="block text-xs text-gray-700 font-ibm-plex-mono whitespace-pre-wrap break-all pr-16 select-text">{value}</code>
      <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-xs text-gray-400 group-hover:text-green-700 transition-colors select-none">
        {copied ? (
          <><Check className="w-3 h-3" /> Copied</>
        ) : (
          <><Copy className="w-3 h-3" /> Copy</>
        )}
      </span>
    </button>
  );
}

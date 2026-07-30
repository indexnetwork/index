import { useState } from "react";
import { Loader2, Send } from "lucide-react";

/** Deterministic round 3: existing memberships plus a free-text escape hatch. */
export function WherePicker({
  networks,
  onSelect,
  busy,
}: {
  networks: Array<{ id: string; title: string }>;
  onSelect: (choice: { networkId?: string; whereText?: string }) => void;
  busy: boolean;
}) {
  const [whereText, setWhereText] = useState("");

  return (
    <section aria-label="Where to look" className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Last one</p>
      <h1 className="mt-3 text-2xl font-semibold leading-tight text-[#041729] sm:text-3xl">
        Where should we look?
      </h1>
      <div className="mt-6 grid gap-3">
        {networks.map((network) => (
          <button
            key={network.id}
            type="button"
            disabled={busy}
            onClick={() => onSelect({ networkId: network.id })}
            className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left text-sm font-medium text-gray-800 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {network.title}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => onSelect({})}
          className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left text-sm font-medium text-gray-800 transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Everywhere
          <span className="mt-1 block text-xs text-gray-500">No community or place constraint</span>
        </button>
      </div>
      <input
        value={whereText}
        onChange={(event) => setWhereText(event.target.value)}
        disabled={busy}
        placeholder="Somewhere more specific?"
        className="mt-4 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#041729] focus:ring-2 focus:ring-[#041729]/10 disabled:opacity-60"
      />
      <button
        type="button"
        disabled={busy || whereText.trim().length === 0}
        onClick={() => onSelect({ whereText: whereText.trim() })}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Continue
      </button>
      <p className="mt-2 text-xs text-gray-500">
        Naming a place rewrites your signal, so it takes a moment longer.
      </p>
    </section>
  );
}

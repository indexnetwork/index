import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, Check, Loader2, Pencil, ShieldCheck, Trash2, X } from 'lucide-react';

import { useAuthenticatedAPI } from '@/lib/api';
import { negotiatorMemoriesPath, negotiatorMemoryPath, type NegotiatorMemoriesResponse, type NegotiatorMemory, type NegotiatorMemoryKind } from '@/services/negotiatorMemories';

/**
 * Negotiator memory panel (P5.4 / IND-408).
 *
 * It's the user's agent — everything it remembers must be inspectable and
 * editable. Groups memories by kind with disclosure rules first and labelled
 * as standing consent (they bind the negotiator in every future negotiation
 * until changed or deleted here). Edits and deletes take effect for the next
 * negotiation immediately.
 */

const KIND_ORDER: NegotiatorMemoryKind[] = [
  'disclosure_rule',
  'threshold',
  'playbook',
  'counterparty_dossier',
];

const KIND_META: Record<NegotiatorMemoryKind, { title: string; description: string }> = {
  disclosure_rule: {
    title: 'Disclosure rules',
    description:
      'What your negotiator may or may not share. These are binding in every negotiation until you edit or delete them.',
  },
  threshold: {
    title: 'Thresholds',
    description: 'Hard limits and reservation points your negotiator holds to.',
  },
  playbook: {
    title: 'Playbooks',
    description: 'Tactics your negotiator has learned work for you.',
  },
  counterparty_dossier: {
    title: 'Counterparty notes',
    description: 'What your negotiator has learned about people it negotiated with.',
  },
};

function MemoryRow({
  memory,
  onSave,
  onDelete,
}: {
  memory: NegotiatorMemory;
  onSave: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const save = async () => {
    const next = draft.trim();
    if (!next || next === memory.content) {
      setEditing(false);
      setDraft(memory.content);
      return;
    }
    setBusy(true);
    try {
      await onSave(memory.id, next);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onDelete(memory.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 rounded-md border border-gray-100 bg-white flex flex-col gap-2">
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          disabled={busy}
          aria-label="Edit memory"
          className="w-full text-sm text-gray-800 border border-gray-200 rounded-md p-2 focus:outline-none focus:border-gray-400"
        />
      ) : (
        <p className="text-sm text-gray-800 leading-relaxed">{memory.content}</p>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          {memory.subjectUser && <span>About {memory.subjectUser.name}</span>}
          <span>Confidence {Math.round(memory.confidence * 100)}%</span>
          <span>{new Date(memory.updatedAt).toLocaleDateString()}</span>
        </div>

        <div className="flex items-center gap-1">
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          ) : editing ? (
            <>
              <button type="button" onClick={save} aria-label="Save memory" className="p-1 text-gray-500 hover:text-black">
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setDraft(memory.content); }}
                aria-label="Cancel edit"
                className="p-1 text-gray-500 hover:text-black"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : confirming ? (
            <>
              <span className="text-[11px] text-gray-500 mr-1">Forget this?</span>
              <button type="button" onClick={remove} aria-label="Confirm delete" className="p-1 text-red-500 hover:text-red-700">
                <Check className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setConfirming(false)} aria-label="Cancel delete" className="p-1 text-gray-500 hover:text-black">
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditing(true)} aria-label="Edit memory" className="p-1 text-gray-400 hover:text-black">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setConfirming(true)} aria-label="Delete memory" className="p-1 text-gray-400 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NegotiatorMemoryPanel({ userId }: { userId: string }) {
  const api = useAuthenticatedAPI();
  const [memories, setMemories] = useState<NegotiatorMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get<NegotiatorMemoriesResponse>(negotiatorMemoriesPath(userId));
      setMemories(res.memories);
      setError(null);
    } catch {
      setError('Failed to load your negotiator’s memory.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const onSave = useCallback(async (id: string, content: string) => {
    const res = await api.patch<{ memory: NegotiatorMemory }>(negotiatorMemoryPath(userId, id), { content });
    setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, ...res.memory, subjectUser: m.subjectUser } : m)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const onDelete = useCallback(async (id: string) => {
    await api.delete(negotiatorMemoryPath(userId, id));
    setMemories((prev) => prev.filter((m) => m.id !== id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const groups = useMemo(
    () =>
      KIND_ORDER
        .map((kind) => ({ kind, items: memories.filter((m) => m.kind === kind) }))
        .filter((g) => g.items.length > 0),
    [memories],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500 py-8">{error}</p>;
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Brain className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">Your negotiator hasn’t learned anything yet</p>
        <p className="text-xs text-gray-400 mt-1 max-w-sm">
          As it negotiates for you — and as you give it standing rules in chat (“never share my
          budget”) — everything it remembers shows up here for you to review, edit, or delete.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      {groups.map(({ kind, items }) => (
        <section key={kind}>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-bold text-black uppercase tracking-wide">
              {KIND_META[kind].title}
            </h2>
            {kind === 'disclosure_rule' && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5">
                <ShieldCheck className="h-3 w-3" />
                Standing consent
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">{KIND_META[kind].description}</p>
          <div className="flex flex-col gap-2">
            {items.map((m) => (
              <MemoryRow key={m.id} memory={m} onSave={onSave} onDelete={onDelete} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

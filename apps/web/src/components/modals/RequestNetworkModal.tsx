import { useState } from 'react';
import type { NetworkRequest, NetworkRequestInput } from '@/services/networkRequests';
import { log } from '@/lib/logger';

const logger = log.ui.from('RequestNetworkModal');

const SIZE_OPTIONS = ['under 100', '100 – 1k', '1k – 10k', '10k+'];

interface RequestNetworkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: NetworkRequestInput) => Promise<NetworkRequest>;
  // When set, the modal edits an existing (needs_changes) request instead of creating one.
  initial?: NetworkRequest | null;
}

/**
 * The caller mounts this with a key that changes whenever the modal opens, so
 * the form seeds itself from `initial` instead of resetting through an effect.
 */
export default function RequestNetworkModal({ open, onOpenChange, onSubmit, initial }: RequestNetworkModalProps) {
  const [name, setName] = useState(initial?.title ?? '');
  const [purpose, setPurpose] = useState(initial?.purpose ?? '');
  const [expectedSize, setExpectedSize] = useState(initial?.expectedSize ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<NetworkRequest | null>(null);

  const isEdit = !!initial;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const request = await onSubmit({
        name: name.trim(),
        purpose: purpose.trim() || undefined,
        expectedSize: expectedSize || undefined,
        notes: notes.trim() || undefined,
      });
      setSubmitted(request);
    } catch (error) {
      logger.error('Error submitting network request', { error });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!isSubmitting) onOpenChange(next);
  };

  if (!open) return null;
  const field = { width: "100%", padding: "8px 10px", fontSize: 13, color: "var(--ink)" } as const;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 110, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", placeItems: "center", background: "rgba(20,20,20,0.18)", padding: 24 }}>
      <div className="amiga-window" style={{ width: 480, maxWidth: "100%", flex: "0 1 auto", border: "1px solid #e3e3e0", borderRadius: 3, boxShadow: "0 4px 12px rgba(0,0,0,.06)" }}>
        <div className="mac-titlebar">
          <span className="mac-title"><span className="t">{submitted ? "request sent" : isEdit ? "update request" : "request a network"}</span></span>
        </div>
        <div className="wb-body mac-scroll" style={{ padding: 18, gap: 12, maxHeight: "70vh", overflowY: "auto" }}>
          {submitted ? (
            <>
              <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>{submitted.title} is in review.</p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="wb-btn" onClick={() => onOpenChange(false)}>back to networks</button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>tell us what you have in mind. every request is reviewed.</p>
              <label className="wb-field">network name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. edge city" disabled={isSubmitting} autoFocus required style={field} />
              <label className="wb-field">what are you hoping to build?</label>
              <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} disabled={isSubmitting} style={field} />
              <label className="wb-field">how many people?</label>
              <div className="wb-segmented" style={{ flexWrap: "wrap", justifySelf: "start" }}>
                {SIZE_OPTIONS.map((opt) => (
                  <button key={opt} type="button" aria-pressed={expectedSize === opt} disabled={isSubmitting} onClick={() => setExpectedSize(expectedSize === opt ? "" : opt)}>{opt}</button>
                ))}
              </div>
              <label className="wb-field">anything else? (optional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={isSubmitting} style={field} />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="wb-btn" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>cancel</button>
                <button type="submit" className="wb-btn primary" disabled={!name.trim() || isSubmitting}>{isSubmitting ? "sending…" : isEdit ? "resubmit" : "request network"}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

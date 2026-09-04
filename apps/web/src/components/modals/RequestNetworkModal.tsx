import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { NetworkRequest, NetworkRequestInput } from '@/services/networkRequests';
import { log } from '@/lib/logger';

const logger = log.ui.from('RequestNetworkModal');

const SIZE_OPTIONS = ['Under 100', '100 – 1K', '1K – 10K', '10K+'];

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

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg w-full max-w-md z-[100] focus:outline-none max-h-[90vh] overflow-y-auto">
          {submitted ? (
            <div className="p-8 text-center">
              <div className="mx-auto mb-4 w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                <Check className="w-5 h-5 text-green-600" />
              </div>
              <h2 className="text-lg font-bold text-black mb-2">Your request is in</h2>
              <p className="text-sm text-gray-600">
                <span className="font-medium text-black">{submitted.title}</span> is in review. You&apos;ll hear back shortly.
              </p>
              <p className="text-sm text-gray-500 mt-3">
                Since networks are still early, we may reach out with a few questions about what you&apos;re building.
              </p>
              <div className="mt-6">
                <Button type="button" onClick={() => onOpenChange(false)}>Close</Button>
              </div>
            </div>
          ) : (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="text-lg font-bold text-black">
                  {isEdit ? 'Update request' : 'Create a network'}
                </Dialog.Title>
                <Dialog.Close className="p-1 rounded-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>

              <p className="text-sm text-gray-600 mb-5">
                Network creation is still early. We&apos;re working closely with the first network creators to understand what
                these spaces should become. Tell us what you have in mind.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1.5">Network name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Edge City" disabled={isSubmitting} autoFocus required />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1.5">What are you hoping to build?</label>
                  <Textarea
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="Who is it for, who do you expect to join, and what should people or agents be able to discover through it?"
                    rows={3}
                    disabled={isSubmitting}
                    className="resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">How many people are you hoping to bring together?</label>
                  <div className="grid grid-cols-2 gap-2">
                    {SIZE_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setExpectedSize(expectedSize === opt ? '' : opt)}
                        disabled={isSubmitting}
                        className={`px-3 py-2 border rounded-sm text-sm text-left transition-colors ${
                          expectedSize === opt ? 'border-black bg-gray-50 text-black' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1.5">
                    Anything else we should know? <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Links, timing, context, or what you'd like to experiment with."
                    rows={2}
                    disabled={isSubmitting}
                    className="resize-none"
                  />
                </div>

                <p className="text-xs text-gray-500">
                  Every request is currently reviewed by the Index team. We&apos;ll get back to you shortly.
                </p>

                <div className="flex justify-end gap-3 pt-1">
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!name.trim() || isSubmitting}>
                    {isSubmitting ? 'Sending...' : isEdit ? 'Resubmit request' : 'Create network'}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";

interface InviteMessageModalProps {
  userName: string;
  message: string;
  loading?: boolean;
  onMessageChange: (message: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function InviteMessageModal({
  userName,
  message,
  loading = false,
  onMessageChange,
  onConfirm,
  onCancel,
}: InviteMessageModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loading) {
      textareaRef.current?.focus();
      const len = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(len, len);
    }
  }, [loading]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl mx-4 p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-gray-900 font-ibm-plex-mono">
              Send a message to invite
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              We'll invite {userName} with your note.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Drafting your invitation message...
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            rows={6}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 resize-none focus:outline-none focus:ring-1 focus:ring-[#041729] focus:border-[#041729]"
            placeholder="Write your message..."
          />
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-sm hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-[#041729] hover:bg-[#0a2d4a] rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send Message
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

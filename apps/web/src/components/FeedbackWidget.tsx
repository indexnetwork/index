import { useState, useRef, useEffect } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { useAIChat } from "@/contexts/AIChatContext";
import { useSaveBarVisible } from "@/contexts/SaveBarContext";
import { getJwtToken } from "@/lib/auth-client";

export default function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { sessionId, messages } = useAIChat();
  const saveBarVisible = useSaveBarVisible();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (!feedback) {
          setIsOpen(false);
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [feedback]);

  const handleSubmit = async () => {
    if (!feedback) return;

    setIsSubmitting(true);

    try {
      const evaluatorUrl =
        import.meta.env.VITE_EVALUATOR_URL || "http://localhost:3002";
      const jwt = await getJwtToken();
      const response = await fetch(`${evaluatorUrl}/api/eval/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          feedback,
          sessionId: sessionId ?? undefined,
          conversation:
            messages.length > 0
              ? messages
                  .slice(-50)
                  .map((m) => ({ role: m.role, content: m.content }))
              : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit feedback");
      }

      setFeedback("");
      setIsOpen(false);
    } catch (error) {
      console.error("Error submitting feedback:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`fixed right-6 bg-white border border-gray-200 shadow-lg transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden z-50 ${
        saveBarVisible ? "bottom-20" : "bottom-6"
      } ${isOpen ? "rounded-lg" : "rounded-md hover:bg-gray-50 hover:shadow-md"}`}
      style={{
        width: isOpen ? "388px" : "111px",
        height: isOpen ? "171px" : "39px",
      }}
    >
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="w-full h-full flex items-center justify-center font-medium text-black text-sm"
          style={{ gap: "8px" }}
        >
          <MessageSquare className="w-4 h-4" />
          Feedback
        </button>
      ) : (
        <div className="relative w-full h-full flex flex-col p-4">
          <textarea
            className="w-full flex-1 resize-none focus:outline-none text-sm text-black placeholder-gray-400 mb-2"
            placeholder="Unleash your thoughts! How can we make your experience better?"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            autoFocus
            disabled={isSubmitting}
          />

          <div className="flex items-center justify-between mt-auto">
            <div className="flex items-center">
              {messages.length > 0 && (
                <span className="text-xs text-gray-400">
                  Includes conversation
                </span>
              )}
            </div>

            <button
              className="bg-[#041729] text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-[#0a2d4a] transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSubmit}
              disabled={isSubmitting || !feedback}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send Feedback"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

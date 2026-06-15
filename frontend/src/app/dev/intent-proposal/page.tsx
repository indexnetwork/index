import { useState } from "react";
import { RotateCcw } from "lucide-react";
import IntentProposalCard, { type IntentProposalData } from "@/components/chat/IntentProposalCard";
import { useNotifications } from "@/contexts/NotificationContext";

const MOCK_CARD: IntentProposalData = {
  proposalId: "test-proposal-123",
  description: "Meet friends who enjoy jazz music in Brooklyn",
  networkId: undefined,
};

export default function IntentProposalTestPage() {
  const [replayKey, setReplayKey] = useState(0);
  const { addNotification } = useNotifications();

  const handleApprove = async (
    proposalId: string,
    description: string,
    networkId?: string
  ) => {
    await new Promise((r) => setTimeout(r, 800));
    console.log("Approve:", { proposalId, description, networkId });
    addNotification({
      type: "intent_broadcast",
      title: "Broadcasting Signal",
      message: description,
      duration: 10000,
      onAction: async () => {
        await new Promise((r) => setTimeout(r, 400));
        console.log("Undo from notification:", proposalId);
      },
    });
  };

  const handleReject = async (proposalId: string) => {
    await new Promise((r) => setTimeout(r, 400));
    console.log("Reject:", proposalId);
  };

  const handleUndo = async (proposalId: string) => {
    await new Promise((r) => setTimeout(r, 400));
    console.log("Undo:", proposalId);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-xl space-y-6">
        <IntentProposalCard
          key={replayKey}
          card={MOCK_CARD}
          onApprove={handleApprove}
          onReject={handleReject}
          onUndo={handleUndo}
        />

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setReplayKey((k) => k + 1)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Replay
          </button>
        </div>
      </div>
    </div>
  );
}

export const Component = IntentProposalTestPage;

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Check, RotateCcw } from "lucide-react";
import { useNotifications } from "@/contexts/NotificationContext";
import { useXMTP } from "@/contexts/XMTPContext";

export type ConnectionAction = 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE';

export interface ConnectionActionsProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  connectionStatus?: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped';
  onAction: (action: ConnectionAction, userId: string) => Promise<void>;
  disabled?: boolean;
  size?: 'sm' | 'default' | 'lg';
  mutualIntents?: Array<{
    intent: {
      id: string;
      summary?: string | null;
      payload: string;
      updatedAt: string;
    };
    totalStake: string;
    agents: unknown[];
  }>;
  synthesis?: string;
}

export default function ConnectionActions({
  userId,
  userName,
  userAvatar,
  connectionStatus = 'none',
  onAction,
  disabled = false,
}: ConnectionActionsProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const { success, error } = useNotifications();
  const { isReady: isChatReady } = useXMTP();

  // Handle message button click - navigates to chat page
  // The actual conversation creation happens in the opportunity acceptance flow
  const handleMessage = () => {
    router.push(`/u/${userId}/chat`);
  };

  const handleAction = async (action: ConnectionAction) => {
    if (disabled || isLoading) return;

    setIsLoading(true);
    try {
      await onAction(action, userId);

      switch (action) {
        case 'CANCEL':
          success("Request Withdrawn", "Message request withdrawn.");
          break;
        case 'ACCEPT':
          success("Connection Accepted", "You can now chat freely!");
          break;
        case 'DECLINE':
          success("Request Declined", "The message request has been declined.");
          break;
        case 'SKIP':
          success("Skipped", "We'll show you fewer suggestions like this.");
          break;
      }
    } catch (err) {
      console.error('Connection action failed:', err);
      error("Action failed", "Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  // Render different buttons based on connection status
  const renderActions = () => {
    switch (connectionStatus) {
      case 'none':
      case 'declined':
      case 'skipped':
        // Skip button to dismiss this suggestion
        return (
          <button
            onClick={() => handleAction('SKIP')}
            disabled={disabled || isLoading}
            className="justify-center cursor-pointer rounded-[2px] font-medium font-sans ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black h-7 px-2.5 text-xs flex items-center gap-2"
            style={{ borderRadius: '2px' }}
          >
            Skip
          </button>
        );

      case 'pending_sent':
        return (
          <button
            onClick={() => handleAction('CANCEL')}
            disabled={disabled || isLoading}
            className="justify-center cursor-pointer rounded-[2px] font-medium font-sans ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black h-7 px-2.5 text-xs flex items-center gap-2"
            style={{ borderRadius: '2px' }}
          >
            <RotateCcw className="h-4 w-4" />
            Cancel
          </button>
        );

      case 'pending_received':
        return (
          <>
            <button
              onClick={() => handleAction('ACCEPT')}
              disabled={disabled || isLoading}
              className="justify-center cursor-pointer rounded-[2px] font-medium font-sans ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-green-600 hover:bg-green-700 text-white h-7 px-2.5 text-xs flex items-center gap-2"
              style={{ borderRadius: '2px' }}
            >
              <Check className="h-4 w-4" />
              Accept
            </button>
            <button
              onClick={() => handleAction('SKIP')}
              disabled={disabled || isLoading}
              className="justify-center cursor-pointer rounded-[2px] font-medium font-sans ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black h-8 px-3 text-xs flex items-center gap-2"
              style={{ borderRadius: '2px' }}
            >
              Skip
            </button>
            <button
              onClick={() => handleAction('DECLINE')}
              disabled={disabled || isLoading}
              className="justify-center cursor-pointer rounded-[2px] font-medium font-sans ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black h-7 px-2.5 text-xs flex items-center gap-2"
              style={{ borderRadius: '2px' }}
            >
              <X className="h-4 w-4" />
              Decline
            </button>
          </>
        );

      case 'connected':
        return null; // Message button handles this case

      default:
        return null;
    }
  };

  // Get message button label based on status
  const getMessageButtonLabel = () => {
    switch (connectionStatus) {
      case 'pending_sent':
        return 'Pending';
      case 'connected':
        return 'Start a conversation';
      default:
        return 'Start a conversation';
    }
  };

  return (
    <div className="flex items-center gap-2">
      {isChatReady && (
        <button
          onClick={handleMessage}
          disabled={disabled || connectionStatus === 'pending_sent'}
          className="justify-center cursor-pointer rounded-[2px] font-medium font-sans ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-[#041729] text-white hover:bg-[#0a2d4a] h-7 px-2.5 text-xs flex items-center gap-2"
          style={{ borderRadius: '2px' }}
        >
          {getMessageButtonLabel()}
        </button>
      )}
      {renderActions()}
    </div>
  );
}

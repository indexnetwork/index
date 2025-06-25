"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UserPlus, UserMinus, X, Check, RotateCcw } from "lucide-react";

export type ConnectionAction = 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE' | 'REMOVE';

export interface ConnectionActionsProps {
  userId: string;
  userName: string;
  connectionStatus?: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped';
  onAction: (action: ConnectionAction, userId: string) => Promise<void>;
  disabled?: boolean;
  size?: 'sm' | 'default' | 'lg';
}

export default function ConnectionActions({
  userId,
  connectionStatus = 'none',
  onAction,
  disabled = false,
  size = 'sm',
}: ConnectionActionsProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleAction = async (action: ConnectionAction) => {
    if (disabled || isLoading) return;
    
    setIsLoading(true);
    try {
      await onAction(action, userId);
    } catch (error) {
      console.error('Connection action failed:', error);
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
        return (
          <>
            <Button
              variant="default"
              size={size}
              onClick={() => handleAction('REQUEST')}
              disabled={disabled || isLoading}
              className="flex items-center gap-2"
            >
              <UserPlus className="h-4 w-4" />
              Connect
            </Button>
            <Button
              variant="outline"
              size={size}
              onClick={() => handleAction('SKIP')}
              disabled={disabled || isLoading}
              className="flex items-center gap-2"
            >
              Skip
            </Button>
          </>
        );

      case 'pending_sent':
        return (
          <Button
            variant="outline"
            size={size}
            onClick={() => handleAction('CANCEL')}
            disabled={disabled || isLoading}
            className="flex items-center gap-2 text-gray-600"
          >
            <RotateCcw className="h-4 w-4" />
            Cancel Request
          </Button>
        );

      case 'pending_received':
        return (
          <>
            <Button
              variant="default"
              size={size}
              onClick={() => handleAction('ACCEPT')}
              disabled={disabled || isLoading}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
            >
              <Check className="h-4 w-4" />
              Accept
            </Button>
            <Button
              variant="outline"
              size={size}
              onClick={() => handleAction('DECLINE')}
              disabled={disabled || isLoading}
              className="flex items-center gap-2 text-red-600 hover:text-red-700"
            >
              <X className="h-4 w-4" />
              Decline
            </Button>
          </>
        );

      case 'connected':
        return (
          <Button
            variant="outline"
            size={size}
            onClick={() => handleAction('REMOVE')}
            disabled={disabled || isLoading}
            className="flex items-center gap-2 text-red-600 hover:text-red-700"
          >
            <UserMinus className="h-4 w-4" />
            Remove
          </Button>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex items-center gap-2">
      {renderActions()}
    </div>
  );
} 
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';

interface ConnectionAcceptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept: () => void;
  connectionName: string;
}

export default function ConnectionAcceptModal({
  isOpen,
  onClose,
  onAccept,
  connectionName,
}: ConnectionAcceptModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAccept = async () => {
    setIsProcessing(true);
    try {
      await onAccept();
    } finally {
      setIsProcessing(false);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Accept Connection Request</DialogTitle>
          <DialogDescription>
            You are about to accept a connection request from {connectionName}. This will:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-300 space-y-2">
            <li>Establish a connection between you and {connectionName}</li>
            <li>Allow them to view your intent details</li>
            <li>Enable them to back your intent with their stake</li>
          </ul>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Note: The connection will be pending until {connectionName} accepts it on their end.
          </div>
        </div>
        <div className="flex justify-end space-x-3 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            className="px-4 py-2 text-white bg-indigo-600 dark:bg-indigo-500 rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing...' : 'Accept Connection'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
} 
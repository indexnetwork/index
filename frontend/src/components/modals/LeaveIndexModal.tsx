import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { Index } from "@/lib/types";

interface LeaveIndexModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: Index | null;
  onLeaveIndex: () => Promise<void>;
  isLeaving: boolean;
}

export default function LeaveIndexModal({ 
  open, 
  onOpenChange, 
  index, 
  onLeaveIndex, 
  isLeaving 
}: LeaveIndexModalProps) {
  const handleLeave = async () => {
    await onLeaveIndex();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 sm:rounded-lg mx-auto">
          <div className="flex flex-col space-y-1.5 text-center sm:text-left">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">
              Leave Index
            </Dialog.Title>
            <Dialog.Description className="text-sm text-gray-500">
              Are you sure you want to leave "{index?.title}"? You will no longer have access to this index and its files unless you are re-invited.
            </Dialog.Description>
          </div>
          
          <div className="flex justify-end space-x-3 mt-6">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLeaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleLeave}
              disabled={isLeaving}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isLeaving ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Leaving...
                </>
              ) : (
                'Leave Index'
              )}
            </Button>
          </div>
          
          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
} 
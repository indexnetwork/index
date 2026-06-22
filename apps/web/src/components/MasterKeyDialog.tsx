import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CopyableBox from '@/components/CopyableBox';

interface MasterKeyDialogProps {
  open: boolean;
  masterKey: string;
  onClose: () => void;
}

export default function MasterKeyDialog({ open, masterKey, onClose }: MasterKeyDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg w-full max-w-md z-[100] focus:outline-none">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-bold text-black">Master Key</Dialog.Title>
              <Dialog.Close className="p-1 rounded-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Save this key now — it will not be shown again. Use it as the <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">x-api-key</code> header when calling the signup endpoint.
            </p>
            <CopyableBox value={masterKey} />
            <div className="flex justify-end mt-4">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

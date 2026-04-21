import * as Dialog from '@radix-ui/react-dialog';
import { Crown, Plus, Users, X } from 'lucide-react';
import NetworkAvatar from '@/components/NetworkAvatar';
import { Network } from '@/lib/types';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useAuthContext } from '@/contexts/AuthContext';

interface NetworkSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenOwnerModal: (network: Network) => void;
  onOpenMemberModal: (network: Network) => void;
  onCreateNetwork?: () => void;
}

export default function NetworkSelectorModal({
  open,
  onOpenChange,
  onOpenOwnerModal,
  onOpenMemberModal,
  onCreateNetwork,
}: NetworkSelectorModalProps) {
  const { user } = useAuthContext();
  const { networks: rawNetworks, loading: networksLoading } = useNetworksState();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in duration-200 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-[400px] bg-white border border-black rounded-[2px] shadow-lg focus:outline-none animate-in fade-in zoom-in-95 duration-200 z-50 max-h-[70vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold font-ibm-plex-mono text-black">
              My Networks
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-gray-500 hover:text-black transition-colors">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto flex-1">
            {networksLoading ? (
              <div className="px-4 py-8 text-center text-gray-500 text-sm font-ibm-plex-mono">
                Loading...
              </div>
            ) : rawNetworks && rawNetworks.length > 0 ? (
              <div className="py-2">
                {rawNetworks.filter(Boolean).map((index) => (
                  <div
                    key={index.id}
                    className="group flex items-center gap-3 justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                      <NetworkAvatar id={index.id} title={index.title} imageUrl={index.imageUrl} size={32} rounded="full" />
                    </div>
                    <span className="flex-1 text-sm font-ibm-plex-mono text-black truncate min-w-0">
                      {index.title}
                    </span>
                    <div className="flex items-center gap-1">
                      {user?.id === index.user?.id && (
                        <button
                          onClick={() => {
                            onOpenChange(false);
                            onOpenOwnerModal(index);
                          }}
                          className="p-1.5 rounded hover:bg-gray-200 transition-colors"
                          title="Admin Settings"
                        >
                          <Crown className="w-4 h-4 text-blue-600" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          onOpenChange(false);
                          onOpenMemberModal(index);
                        }}
                        className="p-1.5 rounded hover:bg-gray-200 transition-colors"
                        title="Member Settings"
                      >
                        <Users className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-gray-500 text-sm font-ibm-plex-mono">
                No networks yet
              </div>
            )}
          </div>

          {user?.email?.endsWith('@index.network') && onCreateNetwork && (
            <div className="border-t border-gray-200 px-4 py-3 flex-shrink-0">
              <button
                onClick={() => {
                  onOpenChange(false);
                  onCreateNetwork();
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-ibm-plex-mono text-gray-700 hover:bg-gray-50 border border-gray-200 rounded transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Network
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

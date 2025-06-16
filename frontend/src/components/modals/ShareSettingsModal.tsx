import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Copy, Globe, Lock, Trash2, Search } from "lucide-react";
import { useState } from "react";
import { Input } from "../ui/input";
import { useIndexes } from "@/contexts/APIContext";
import { Index } from "@/lib/types";

interface ShareSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: Index;
  onIndexUpdate?: (updatedIndex: Index) => void;
}

interface DialogProps {
  className?: string;
  children: React.ReactNode;
  [key: string]: unknown;
}

// Create simple wrapper components for dialog parts
const DialogContent = ({ className, children, ...props }: DialogProps) => (
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
    <Dialog.Content
      className={`fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 sm:rounded-lg ${className}`}
      {...props}
    >
      {children}
      <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
        <span className="sr-only">Close</span>
      </Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
);

const DialogHeader = ({ className, children, ...props }: DialogProps) => (
  <div className={`flex flex-col space-y-1.5 text-center sm:text-left ${className}`} {...props}>
    {children}
  </div>
);

const DialogTitle = ({ className, children, ...props }: DialogProps) => (
  <Dialog.Title className={`text-lg font-semibold leading-none tracking-tight ${className}`} {...props}>
    {children}
  </Dialog.Title>
);

export default function ShareSettingsModal({ open, onOpenChange, index, onIndexUpdate }: ShareSettingsModalProps) {
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
  const [isUpdatingDiscovery, setIsUpdatingDiscovery] = useState(false);
  const indexesService = useIndexes();

  const handleToggleVisibility = async (isPublic: boolean) => {
    try {
      setIsUpdatingVisibility(true);
      await indexesService.updateIndex(index.id, { isPublic });
      // Refetch the complete index data to ensure we have all files
      const updatedIndex = await indexesService.getIndex(index.id);
      onIndexUpdate?.(updatedIndex);
    } catch (error) {
      console.error('Error updating index visibility:', error);
    } finally {
      setIsUpdatingVisibility(false);
    }
  };

  const handleToggleDiscovery = async (isDiscoverable: boolean) => {
    try {
      setIsUpdatingDiscovery(true);
      await indexesService.updateIndex(index.id, { isDiscoverable });
      // Refetch the complete index data to ensure we have all files
      const updatedIndex = await indexesService.getIndex(index.id);
      onIndexUpdate?.(updatedIndex);
    } catch (error) {
      console.error('Error updating index discovery settings:', error);
    } finally {
      setIsUpdatingDiscovery(false);
    }
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  // Generate a share link when public
  const shareUrl = `http://localhost:3000/share/${index.id}`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg mx-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-black font-mono">
            {index.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-8 mt-6">
          <div>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-md font-medium font-ibm-plex-mono text-black">Discovery</h3>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    {index.isDiscoverable ? (
                      <>
                        <Search className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" />
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  Allow relevant users to find this index through intent matching
                </p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                {isUpdatingDiscovery && (
                  <div className="h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                )}
                <button
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    index.isDiscoverable ? 'bg-blue-600' : 'bg-gray-300'
                  } ${isUpdatingDiscovery ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  onClick={() => !isUpdatingDiscovery && handleToggleDiscovery(!index.isDiscoverable)}
                  disabled={isUpdatingDiscovery}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      index.isDiscoverable ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mt-2 mb-2">
                  <h3 className="text-md font-medium font-ibm-plex-mono text-black">Public Link</h3>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    {index.isPublic ? (
                      <>
                        <Globe className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" />
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  {index.isPublic 
                    ? "Anyone can view this index" 
                    : "Only you and invited members can view"
                  }
                </p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                {isUpdatingVisibility && (
                  <div className="h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                )}
                <button
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    index.isPublic ? 'bg-blue-600' : 'bg-gray-300'
                  } ${isUpdatingVisibility ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  onClick={() => !isUpdatingVisibility && handleToggleVisibility(!index.isPublic)}
                  disabled={isUpdatingVisibility}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      index.isPublic ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {index.isPublic && (
              <div className="mt-4">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={shareUrl}
                    className="px-4 py-3"
                    placeholder="Share link will appear here..."
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 px-4"
                    onClick={() => handleCopyLink(shareUrl)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-md font-medium font-ibm-plex-mono text-black mb-3">Members</h3>
            
            <div className="space-y-3">
              {[
                { name: "Alice Smith", email: "alice@example.com", role: "Editor" },
                { name: "Bob Johnson", email: "bob@example.com", role: "Viewer" },
              ].map((viewer, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-4 bg-gray-50 "
                >
                  <div>
                    <p className="text-md text-black">{viewer.name}</p>
                    <p className="text-sm text-gray-600">{viewer.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog.Root>
  );
} 
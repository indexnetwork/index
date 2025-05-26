import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Copy, Plus } from "lucide-react";
import { useState } from "react";
import { Input } from "../ui/input";

interface ShareLink {
  id: string;
  url: string;
  createdAt: string;
}

interface ShareSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indexName: string;
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

export default function ShareSettingsModal({ open, onOpenChange, indexName }: ShareSettingsModalProps) {
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([
    { 
      id: '1', 
      url: 'http://localhost:3000/share/1',
      createdAt: new Date().toISOString()
    }
  ]);

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const generateNewLink = () => {
    const newLink: ShareLink = {
      id: Math.random().toString(36).substring(7),
      url: `https://index.network/share/${Math.random().toString(36).substring(7)}`,
      createdAt: new Date().toISOString()
    };
    setShareLinks([...shareLinks, newLink]);
  };

  const removeLink = (id: string) => {
    setShareLinks(shareLinks.filter(link => link.id !== id));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-black font-mono">
            {indexName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-8 mt-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-md font-medium font-ibm-plex-mono text-black">Share link</h3>
              <Button
                variant="outline"
                size="lg"
                className="h-9 px-3"
                onClick={generateNewLink}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Link
              </Button>
            </div>
            <div className="space-y-2">
              {shareLinks.map((link) => (
                <div 
                  key={link.id}
                  className="flex items-center gap-2"
                >
                  
                  <Input
                    readOnly
                    id="name"
                    value={link.url}
                    className=" px-4 py-3"
                    placeholder="Enter index name..."
                    required
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 px-4"
                    onClick={() => handleCopyLink(link.url)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 px-4 text-red-500 hover:text-red-600"
                    onClick={() => removeLink(link.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-md font-medium font-ibm-plex-mono text-black mb-3">People with access</h3>
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
                    <p className="text-xl text-black">{viewer.name}</p>
                    <p className="text-gray-600">{viewer.email}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-5 w-5" />
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
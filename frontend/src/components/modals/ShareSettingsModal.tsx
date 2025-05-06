import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link, Trash2, Copy, Plus } from "lucide-react";
import { useState } from "react";

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

export default function ShareSettingsModal({ open, onOpenChange, indexName }: ShareSettingsModalProps) {
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([
    { 
      id: '1', 
      url: 'https://index.network/share/p2orda',
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-black font-mono">
            {indexName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-8 mt-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-md font-medium font-ibm-plex text-black">Share link</h3>
              <Button
                variant="outline"
                size="md"
                className="h-9 px-3 bg-white border border-gray-200 rounded-[1px] hover:bg-gray-50 text-gray-700"
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
                  <div className="flex-1 bg-white border border-gray-200 rounded-[1px] px-4 py-1.75 text-gray-600">
                    {link.url}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 px-4 bg-white border border-gray-200 rounded-[1px] hover:bg-gray-50 text-gray-700"
                    onClick={() => handleCopyLink(link.url)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 px-4 bg-white border border-gray-200 rounded-[1px] hover:bg-gray-50 text-red-500 hover:text-red-600"
                    onClick={() => removeLink(link.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-md font-medium font-ibm-plex text-black mb-3">People with access</h3>
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
                      className="text-red-500 hover:text-red-700 p-0"
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
    </Dialog>
  );
} 
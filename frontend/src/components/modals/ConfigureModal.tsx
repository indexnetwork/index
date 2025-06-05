"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, Check, X } from "lucide-react";

interface ConfigureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ConfigureModal({ open, onOpenChange }: ConfigureModalProps) {
  const [copied, setCopied] = useState(false);

  const mcpServerConfig = {
    "mcpServers": {
      "index-network": {
        "command": "npx",
        "args": [
          "-y",
          "@indexnetwork/mcp"
        ]
      }
    }
  };

  const handleCopyConfig = () => {
    navigator.clipboard.writeText(JSON.stringify(mcpServerConfig, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-lg max-w-lg w-full mx-4 p-6 z-50">
          <div className="flex justify-between items-center mb-4">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Configure MCP Server</Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          
          <Dialog.Description className="text-gray-600 mb-6">
            Set up your Model Context Protocol server configuration.
          </Dialog.Description>

          <div className="space-y-6">
            <div className="bg-gray-50 p-4 rounded-md overflow-auto border border-gray-200">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-700">Configuration JSON</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={handleCopyConfig}
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <pre className="text-sm text-gray-900 whitespace-pre-wrap">
                {JSON.stringify(mcpServerConfig, null, 2)}
              </pre>
            </div>

            <div className="bg-yellow-50 p-4 border border-gray-200">
              <p className="text-gray-800 text-sm mb-4">Setup Instructions:</p>
              <ol className="text-gray-800 text-sm list-decimal list-inside space-y-2">
                <li>Copy the configuration JSON</li>
                <li>Save it as <code className="bg-yellow-100 px-1">mcp-config.json</code> in your project root</li>
                <li>Run <code className="bg-yellow-100 px-1">mcp start</code> to begin indexing</li>
              </ol>
            </div>

            <div className="flex justify-end space-x-3">
              <Dialog.Close asChild>
                <Button onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
} 
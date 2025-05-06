"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Copy, Check } from "lucide-react";

interface ConfigureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ConfigureModal({ open, onOpenChange }: ConfigureModalProps) {
  const [copied, setCopied] = useState(false);

  const mcpServerConfig = {
    "mcpServers": {
      "github": {
        "command": "docker",
        "args": [
          "run",
          "-i",
          "--rm",
          "mcp/github"
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg mx-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900 font-ibm-plex">Configure MCP Server</DialogTitle>
          <DialogDescription>
            Set up your Model Context Protocol server configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="bg-gray-50 p-4 rounded-md overflow-auto border border-gray-200">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">Configuration JSON</span>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center rounded-[1px] gap-2 text-gray-700"
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
            <Button
              variant="outline" 
              onClick={() => onOpenChange(false)}
              className="font-medium text-gray-700 rounded-[1px] cursor-pointer hover:bg-gray-50"
            >
              Cancel
            </Button>
            <Button
              onClick={() => onOpenChange(false)}
              className="font-medium bg-gray-800 rounded-[1px] cursor-pointer hover:bg-black text-white"
            >
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
} 
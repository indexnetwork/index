'use client';

import { useState, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { X, Download, Upload } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useIndexService } from '@/services/indexes';

interface BulkImportMembersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indexId: string;
  onSuccess?: () => void;
}

export default function BulkImportMembersModal({ 
  open, 
  onOpenChange, 
  indexId,
  onSuccess 
}: BulkImportMembersModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { success, error } = useNotifications();
  const indexService = useIndexService();

  const handleDownloadExample = () => {
    const csvContent = 'email,name,intro,twitter,website,location,role,expertise\njohn@example.com,John Smith,Product designer focused on AI,@johnsmith,https://johnsmith.com,San Francisco,Senior Designer,"UI design, prototyping"\njane@example.com,Jane Doe,Backend engineer,@janedoe,https://janedoe.dev,New York,Tech Lead,"Node.js, databases, APIs"\n';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'members_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleFileSelect = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      error('Please select a CSV file');
      return;
    }
    setSelectedFile(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      error('Please select a file first');
      return;
    }

    setIsUploading(true);
    try {
      const result = await indexService.bulkImportMembers(indexId, selectedFile);
      success(`Successfully imported ${result.count || 0} member(s)`);
      setSelectedFile(null);
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      console.error('Error uploading file:', err);
      error('Failed to import members. Please check your file format and try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      setSelectedFile(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in duration-200 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-[520px] bg-white border border-gray-200 rounded-lg p-6 shadow-xl focus:outline-none animate-in fade-in zoom-in-95 duration-200 z-50">
          <div className="flex items-center justify-between mb-6">
            <Dialog.Title className="text-lg font-bold text-gray-900 font-ibm-plex-mono">
              Import Members
            </Dialog.Title>
            <button
              onClick={handleClose}
              disabled={isUploading}
              className="rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 disabled:opacity-50"
            >
              <X className="h-4 w-4 text-gray-600" />
              <span className="sr-only">Close</span>
            </button>
          </div>

          <div className="space-y-4">
            {/* Instructions */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-blue-900 font-ibm-plex-mono mb-2">
                How it works
              </h4>
              <ol className="text-xs text-blue-800 space-y-1.5 font-ibm-plex-mono list-decimal list-inside">
                <li>Download the example CSV template below</li>
                <li>Fill in your members&apos; details (email is required)</li>
                <li>Profile fields (name, intro, twitter, website, location) update user profiles if empty</li>
                <li>Any extra columns become member-specific metadata in this index</li>
                <li>Upload the completed CSV file</li>
              </ol>
            </div>

            {/* Download Example */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-gray-900 font-ibm-plex-mono mb-1">
                    CSV Template
                  </h4>
                  <p className="text-xs text-gray-600 mb-3">
                    Download a template with the correct format
                  </p>
                  
                  <p className="text-xs text-gray-500 italic">
                    Use commas within a value for arrays (e.g., &quot;design, prototyping&quot;)
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadExample}
                  className="font-ibm-plex-mono ml-4"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>

            {/* Upload Area */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-900 font-ibm-plex-mono mb-3">
                Upload CSV File
              </h4>
              
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  dragActive 
                    ? 'border-blue-400 bg-blue-50' 
                    : 'border-gray-300 bg-gray-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                
                {selectedFile ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-700">
                      <Upload className="h-5 w-5 text-green-600" />
                      <span className="font-medium font-ibm-plex-mono">{selectedFile.name}</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {(selectedFile.size / 1024).toFixed(2)} KB
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="font-ibm-plex-mono"
                    >
                      Change File
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Upload className="h-8 w-8 text-gray-400 mx-auto" />
                    <div>
                      <p className="text-sm text-gray-600 mb-1 font-ibm-plex-mono">
                        Drag and drop your CSV file here
                      </p>
                      <p className="text-xs text-gray-500 mb-3">or</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="font-ibm-plex-mono"
                      >
                        Browse Files
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isUploading}
                className="font-ibm-plex-mono"
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading}
                className="font-ibm-plex-mono"
              >
                {isUploading ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Import Members
                  </>
                )}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}


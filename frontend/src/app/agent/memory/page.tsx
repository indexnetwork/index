'use client';

import { useState } from 'react';
import FileUpload from '@/components/FileUpload';
import FileList from '@/components/FileList';
import IntegrationList from '@/components/IntegrationList';
import { useFiles } from '@/contexts/FileContext';
import { File as FileType } from '@/types';

export default function AgentMemory() {
  const { addFile } = useFiles();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFilesSelected = async (selectedFiles: globalThis.File[]) => {
    setIsProcessing(true);
    
    // Simulate file processing and encryption
    for (const file of selectedFiles) {
      const newFile: FileType = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toISOString(),
        status: 'processing',
        source: 'linkedin'
      };
      
      addFile(newFile);
      
      // Simulate encryption process
      setTimeout(() => {
        addFile({
          ...newFile,
          status: 'encrypted'
        });
      }, 2000);
    }
    
    setIsProcessing(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-6">
      <div className="space-y-12">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Memory</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            Securely manage your files and connect your accounts. All data is encrypted and only accessible to your agent.
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Connected Services</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Connect your accounts to automatically sync relevant files and data.
            </p>
          </div>
          <IntegrationList />
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Your Files</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Upload and manage your files. All files are encrypted end-to-end.
            </p>
          </div>
          <FileList />
          <FileUpload onFilesSelected={handleFilesSelected} />
        </div>
      </div>
    </div>
  );
} 
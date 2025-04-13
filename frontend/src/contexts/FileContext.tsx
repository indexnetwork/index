'use client';

import React, { createContext, useContext, useState } from 'react';
import { File } from '@/types';

interface FileContextType {
  files: File[];
  addFile: (file: File) => void;
  removeFile: (id: string) => void;
  updateFileStatus: (id: string, status: File['status']) => void;
}

const FileContext = createContext<FileContextType | undefined>(undefined);

export function FileProvider({ children }: { children: React.ReactNode }) {
  const [files, setFiles] = useState<File[]>([
    {
      id: 'pitch-deck-123',
      name: 'pitch_deck.pdf',
      size: 7.5 * 1024 * 1024, // 7.5MB
      type: 'application/pdf',
      uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
      status: 'encrypted',
      source: 'linkedin'
    },
    {
      id: 'onepager-456',
      name: 'onepager.pdf',
      size: 1.2 * 1024 * 1024, // 1.2MB
      type: 'application/pdf',
      uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
      status: 'encrypted',
      source: 'linkedin'
    }
  ]);

  const addFile = (file: File) => {
    setFiles(prev => [...prev, file]);
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(file => file.id !== id));
  };

  const updateFileStatus = (id: string, status: File['status']) => {
    setFiles(prev => prev.map(file => 
      file.id === id ? { ...file, status } : file
    ));
  };

  return (
    <FileContext.Provider value={{ files, addFile, removeFile, updateFileStatus }}>
      {children}
    </FileContext.Provider>
  );
}

export function useFiles() {
  const context = useContext(FileContext);
  if (context === undefined) {
    throw new Error('useFiles must be used within a FileProvider');
  }
  return context;
} 
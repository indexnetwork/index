'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileUp, Lock } from 'lucide-react';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
}

export default function FileUpload({ onFilesSelected }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    onFilesSelected(acceptedFiles);
  }, [onFilesSelected]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv']
    },
    maxSize: 500 * 1024 * 1024, // 500MB
  });

  return (
    <div
      {...getRootProps()}
      className={`relative overflow-hidden rounded-xl border-2 border-dashed transition-all duration-200 ${
        isDragActive 
          ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20' 
          : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
      }`}
    >
      <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]" 
           style={{ 
             backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
             backgroundSize: '24px 24px' 
           }} 
      />
      
      <div className="relative p-8">
        <input {...getInputProps()} />
        
        <div className="flex flex-col items-center space-y-4">
          <div className={`p-4 rounded-xl transition-colors ${
            isDragActive 
              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400' 
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}>
            <FileUp className="w-8 h-8" />
          </div>
          
          <div className="text-center space-y-2">
            <p className="text-lg font-medium text-gray-900 dark:text-white">
              {isDragActive ? 'Drop files here' : 'Drag & drop files here'}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              or click to browse
            </p>
          </div>
          
          <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
            <Lock className="w-4 h-4" />
            <span>Files are encrypted end-to-end</span>
          </div>
          
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Supports PDF, DOC, PPT, XLS, CSV (up to 500MB)
          </p>
        </div>
      </div>
    </div>
  );
} 
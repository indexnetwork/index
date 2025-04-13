'use client';

import { useFiles } from '@/contexts/FileContext';
import { FileText, Lock, Trash2, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function FileList() {
  const { files, removeFile } = useFiles();

  if (files.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/50 p-12">
        <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]" 
             style={{ 
               backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
               backgroundSize: '24px 24px' 
             }} 
        />
        <div className="relative text-center">
          <FileText className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-600" />
          <h3 className="mt-4 text-sm font-medium text-gray-900 dark:text-white">No files uploaded</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Get started by uploading your first file or connecting an integration
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {files.map((file) => (
        <div
          key={file.id}
          className="group relative overflow-hidden rounded-xl border transition-all duration-200 bg-white dark:bg-gray-800/50 border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
        >
          <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]" 
               style={{ 
                 backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
                 backgroundSize: '24px 24px' 
               }} 
          />
          
          <div className="relative p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-4">
                <div className="p-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    {file.name}
                  </h3>
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <span>{formatBytes(file.size)}</span>
                    </div>
                    <div className="flex items-center space-x-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <Clock className="w-3.5 h-3.5" />
                      <span>
                        Uploaded {formatDistanceToNow(new Date(file.uploadedAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => removeFile(file.id)}
                className="p-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                title="Delete file"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center space-x-2 text-sm">
              {file.status === 'processing' && (
                <div className="flex items-center space-x-2 text-yellow-600 dark:text-yellow-400">
                  <AlertCircle className="w-4 h-4" />
                  <span>Processing...</span>
                </div>
              )}
              {file.status === 'encrypted' && (
                <div className="flex items-center space-x-2 text-green-600 dark:text-green-400">
                  <Lock className="w-4 h-4" />
                  <span>Encrypted and secure</span>
                </div>
              )}
              {file.status === 'ready' && (
                <div className="flex items-center space-x-2 text-blue-600 dark:text-blue-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Ready</span>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
} 
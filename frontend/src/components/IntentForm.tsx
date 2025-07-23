"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, Paperclip } from "lucide-react";

interface IntentFormProps {
  onSubmit: (data: { payload: string; files: File[]; vibeCheckIndex?: string }) => void;
  isSubmitting?: boolean;
  submitButtonText?: string;
  placeholder?: string;
  className?: string;
  vibeCheckIndex?: string; // Optional index code for vibe check functionality
}

export default function IntentForm({
  onSubmit,
  isSubmitting = false,
  submitButtonText = "Submit Intent",
  placeholder = "Describe what you're looking for, working on, or hoping to achieve...",
  className = "",
  vibeCheckIndex
}: IntentFormProps) {
  const [payload, setPayload] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [payload]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!payload.trim() && files.length === 0) return;
    
    // Pass the data to parent handler (including vibeCheckIndex if provided)
    onSubmit({ payload: payload.trim(), files, vibeCheckIndex });
  }, [payload, files, vibeCheckIndex, onSubmit]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...selectedFiles]);
    // Reset input to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);



  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isValid = payload.trim() || files.length > 0;

  return (
    <div className={`w-full max-w-4xl mx-auto ${className}`}>
      <div className="">


        {/* Content Section */}
        <div className="py-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Unified Input Container */}
            <div className="border border-gray-200 overflow-hidden  transition-all">
              {/* Text Input Area */}
              <div className="relative bg-gray-50/50">
                <textarea
                  ref={textareaRef}
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  placeholder={placeholder}
                  className="w-full p-4 pb-14 bg-transparent border-0 focus:ring-0 focus:outline-none resize-none overflow-hidden text-gray-900 placeholder-gray-500"
                  rows={4}
                  disabled={isSubmitting}
                />
                
                {/* Floating Attachment Button */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                  className="absolute bottom-3 rounded-sm left-4 flex items-center gap-2 bg-white/95 backdrop-blur-sm hover:bg-white shadow-sm border-gray-300 h-8"
                >
                  <Paperclip className="h-4 w-4" />
                  <span className="hidden sm:inline text-sm">Attach files</span>
                </Button>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={isSubmitting}
                />
              </div>

              {/* File Display Area */}
              {files.length > 0 && (
                <div className="bg-gray-100/30 border-t border-gray-200/50">
                  <div className="p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {files.map((file, index) => (
                        <div
                          key={`${file.name}-${index}`}
                          className="relative group bg-white border border-gray-200 rounded-lg p-3 hover:shadow-sm hover:border-gray-300 transition-all"
                        >
                          {/* File Type Badge */}
                          <div className="absolute top-2 right-2">
                            <span className="inline-block px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-md uppercase">
                              {file.name.split('.').pop() || 'FILE'}
                            </span>
                          </div>
                          
                          {/* Remove Button */}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleRemoveFile(index)}
                            disabled={isSubmitting}
                            className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0 bg-red-50 border-red-200 hover:bg-red-100 rounded-md"
                          >
                            <X className="h-3 w-3 text-red-600" />
                          </Button>
                          
                          {/* File Icon/Preview */}
                          <div className="flex items-center justify-center h-12 mb-3 mt-4">
                            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                              <Paperclip className="h-5 w-5 text-blue-600" />
                            </div>
                          </div>
                          
                          {/* File Info */}
                          <div className="text-center">
                            <p className="text-xs font-medium text-gray-900 truncate mb-1" title={file.name}>
                              {file.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {formatFileSize(file.size)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

                          {/* Action Button */}
              <div className="flex">
                <Button
                  type="submit"
                  disabled={!isValid || isSubmitting}
                  className="w-full bg-black text-white hover:bg-gray-800 h-11 font-medium"
                >
                  {isSubmitting ? 'Processing...' : submitButtonText}
                </Button>
              </div>
          </form>
        </div>
      </div>
    </div>
  );
} 
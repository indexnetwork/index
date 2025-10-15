"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, Paperclip, Upload } from "lucide-react";
import { validateFileUploads, getSupportedFileExtensions, formatFileSize } from "../lib/uploads";
import { useNotifications } from "../contexts/NotificationContext";

interface IntentFormProps {
  onSubmit: (data: { payload: string; files: File[]; vibeCheckIndex?: string }) => void;
  isSubmitting?: boolean;
  submitButtonText?: string;
  className?: string;
  vibeCheckIndex?: string; // Optional index code for vibe check functionality
}

export default function IntentForm({
  onSubmit,
  isSubmitting = false,
  submitButtonText = "Submit Intent",
  className = "",
  vibeCheckIndex
}: IntentFormProps) {
  const [payload, setPayload] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { error } = useNotifications();

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
    
    // Validate against the combined file array to enforce cumulative constraints
    const nextFiles = [...files, ...selectedFiles];
    const validation = validateFileUploads(nextFiles, 'general');
    if (!validation.isValid) {
      error(validation.message || 'Invalid file');
      return;
    }
    
    setFiles(nextFiles);
    // Reset input to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [files, error]);

  const handleRemoveFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      // Validate against the combined file array to enforce cumulative constraints
      const nextFiles = [...files, ...droppedFiles];
      const validation = validateFileUploads(nextFiles, 'general');
      if (!validation.isValid) {
        error(validation.message || 'Invalid file');
        return;
      }
      
      setFiles(nextFiles);
    }
  }, [files, error]);

  // Use imported formatFileSize function

  const isValid = payload.trim() || files.length > 0;

  return (
    <div 
      className={`w-full max-w-4xl mx-auto ${className} ${isDragging ? 'bg-gray-50' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="py-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Files Section */}
          <div className="space-y-2">
            <label className="text-md font-bold text-gray-700">
              Upload any materials that help bring your work into focus:
            </label>
            <p className="text-sm text-gray-600 mb-2">
              Attach drafts, decks, notes, prototypes, or anything else that helps agents see the bigger picture.
            </p>
            <p className="text-xs text-gray-500 mb-4">
              Supported: PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, JSON, MD, PPT, PPTX, RTF, ODT, XML, YAML, HTML, EPUB, EML, MSG, MBOX, ZIP. Max size: 10MB (max 10 files)
            </p>
            <div 
              className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors cursor-pointer ${
                isDragging 
                  ? "border-gray-400 bg-gray-100" 
                  : "border-gray-200 bg-gray-50 hover:bg-gray-100"
              }`}
            >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              id="file-upload-intent"
              multiple
              accept={getSupportedFileExtensions('general')}
              onChange={handleFileSelect}
              disabled={isSubmitting}
            />
            <label
              htmlFor="file-upload-intent"
              className="flex flex-col items-center cursor-pointer w-full"
            >
              <Upload className={`h-6 w-6 mb-2 ${isDragging ? 'text-gray-600' : 'text-gray-400'}`} />
              <p className="text-sm font-medium text-gray-900">Upload Files</p>
            </label>
            </div>

            {/* File Display Area - Now below drop zone */}
            {files.length > 0 && (
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
            )}
          </div>

          {/* Text Input Section */}
          <div className="mt-8 space-y-2">
            <label className="text-md font-bold text-gray-700">
            Tell agents what you're open to:
            </label>
            
            <p className="text-sm text-gray-600">
            Whether it's collaboration, investors, or something else, describe your goals so agents understand where you're headed.
            </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50/50">
              <textarea
                ref={textareaRef}
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder={`Say what you're looking for—plain and simple.

"Looking to find early-stage founders building privacy preserving agent infrastructure."
"I want to connect with ZK/ML researchers and builders."`}
                className="w-full p-4 bg-transparent border-0 focus:ring-0 focus:outline-none resize-none overflow-hidden text-gray-900 placeholder-gray-500"
                rows={4}
                disabled={isSubmitting}
              />
            </div>
            </div>
          </div>

          {/* Submit Button */}
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
  );
} 
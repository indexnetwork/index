"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Link, Paperclip, X } from "lucide-react";

interface DiscoveryFormProps {
  onRequestsClick: () => void;
  requestsCount: number;
}

export default function DiscoveryForm({ onRequestsClick, requestsCount }: DiscoveryFormProps) {
  const [inputValue, setInputValue] = useState('');
  const [originalInputValue, setOriginalInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isFileDialogOpen, setIsFileDialogOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFiles(prev => [...prev, file]);
      // Reset the input value to allow selecting the same file again
      event.target.value = '';
    }
    // Always reset the file dialog state and refocus
    setIsFileDialogOpen(false);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  // Remove a specific file
  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Get stripped filename for display
  const getDisplayName = (file: File) => {
    // Remove extension and clean up the filename
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
    // Replace underscores and hyphens with spaces, limit length
    const cleaned = nameWithoutExt.replace(/[_-]/g, ' ').trim();
    // Truncate if too long
    return cleaned.length > 20 ? cleaned.substring(0, 20) + '...' : cleaned;
  };

  // Trigger file input
  const handleFileButtonClick = () => {
    setIsFileDialogOpen(true);
    fileInputRef.current?.click();
    
    // Handle case where user cancels file dialog
    const handleFocus = () => {
      setTimeout(() => {
        if (isFileDialogOpen) {
          setIsFileDialogOpen(false);
          inputRef.current?.focus();
        }
      }, 100);
      window.removeEventListener('focus', handleFocus);
    };
    
    window.addEventListener('focus', handleFocus);
  };

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    if (inputRef.current) {
      if (inputFocused) {
        // When dropdown is open, allow growth up to ~10 lines
        inputRef.current.style.height = 'auto';
        const maxHeight = 240; // Max height for ~10 lines
        const scrollHeight = inputRef.current.scrollHeight;
        inputRef.current.style.height = Math.min(scrollHeight, maxHeight) + 'px';
        inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
      } else {
        // When closed, single line
        inputRef.current.style.height = 'auto';
        inputRef.current.style.overflowY = 'hidden';
      }
    }
  }, [inputFocused]);

  // Update textarea when focus state or content changes
  useEffect(() => {
    autoResize();
  }, [inputFocused, inputValue, autoResize]);

  // Ensure textarea stays focused when switching to open state
  useEffect(() => {
    if (inputFocused && inputRef.current) {
      // Small delay to ensure DOM has updated
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Set cursor to end of text
          const length = inputRef.current.value.length;
          inputRef.current.setSelectionRange(length, length);
        }
      }, 0);
    }
  }, [inputFocused]);

  // Auto-focus input on keypress
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Check if any modal is open by looking for modal elements
      // Radix UI Dialog components have data-radix-dialog-content attribute
      const hasModalOpen = document.querySelector('[data-radix-dialog-content], [role="dialog"]') !== null;
      
      if (inputRef.current && !inputFocused && !hasModalOpen) {
        // Focus on Enter or when typing regular characters
        if (e.key === 'Enter' || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
          e.preventDefault();
          inputRef.current.focus();
          // Set cursor to end of text
          const length = inputRef.current.value.length;
          inputRef.current.setSelectionRange(length, length);
          if (e.key.length === 1) {
            setInputValue(prev => prev + e.key);
            setInputFocused(true);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [inputFocused]);

  return (
    <div className="space-y-4">
      {/* Input and button row */}
      <div className="flex gap-4 items-start">
        <div className="flex-1 relative">
          {!inputFocused ? (
            /* Closed state - simple input */
            <div className="bg-white border border-b-2 border-gray-800 flex items-center px-4 py-3 h-[54px]">
              <textarea
                ref={inputRef}
                placeholder="What do you want to discover?"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  autoResize();
                }}
                onFocus={() => {
                  setInputFocused(true);
                  setOriginalInputValue(inputValue);
                }}
                onBlur={() => {
                  if (!isFileDialogOpen) {
                    setTimeout(() => setInputFocused(false), 100);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    // Enter without shift submits the form
                    e.preventDefault();
                    setInputFocused(false);
                    inputRef.current?.blur();
                    // TODO: Add form submission logic here
                  } else if (e.key === 'Enter' && e.shiftKey) {
                    // Shift+Enter opens the dropdown for multi-line editing
                    e.preventDefault();
                    setInputFocused(true);
                  }
                }}
                rows={1}
                className="flex-1 text-lg font-ibm-plex-mono border-none focus:outline-none bg-transparent text-black placeholder-gray-500 resize-none overflow-hidden"
              />
              {selectedFiles.length > 0 && (
                <div className="flex items-center gap-1 text-gray-600 ml-2">
                  <Paperclip className="w-4 h-4" />
                  <span className="text-sm font-ibm-plex-mono">{selectedFiles.length}</span>
                </div>
              )}
            </div>
          ) : (
            /* Open state - dropdown with integrated textarea */
            <div 
              className="absolute top-0 left-0 right-0 bg-white border border-b-2 border-gray-800 space-y-4 z-[9999] shadow-lg"
            >
              {/* Textarea at top of dropdown */}
              <div className="px-4 py-3">
                <textarea
                  ref={inputRef}
                  placeholder="What do you want to discover?"
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    autoResize();
                  }}
                  onBlur={() => {
                    if (!isFileDialogOpen) {
                      setTimeout(() => setInputFocused(false), 100);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      // Enter without shift submits the form
                      e.preventDefault();
                      setInputFocused(false);
                      inputRef.current?.blur();
                      // TODO: Add form submission logic here
                    } else if (e.key === 'Enter' && e.shiftKey) {
                      // Shift+Enter adds new line (default behavior)
                      // Don't prevent default to allow new line
                    } else if (e.key === 'Escape') {
                      setInputValue(originalInputValue);
                      setInputFocused(false);
                      inputRef.current?.blur();
                    }
                  }}
                  rows={1}
                  className="w-full text-lg font-ibm-plex-mono border-none focus:outline-none bg-transparent text-black placeholder-gray-500 resize-none"
                />
              </div>
              
              {/* File tags */}
              {selectedFiles.length > 0 && (
                <div className="px-4">
                  <div className="flex flex-wrap gap-2">
                    {selectedFiles.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-sm font-ibm-plex-mono"
                      >
                        <span>📄</span>
                        <span>{getDisplayName(file)}</span>
                        <button
                          onClick={() => removeFile(index)}
                          onMouseDown={(e) => e.preventDefault()}
                          className="hover:text-red-600 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="px-4 pb-4 space-y-4">
              {/* Upload section */}
              <div className="space-y-3">
                <p className="text-sm text-gray-600 font-ibm-plex-mono">
                  upload your pitch deck, one-pager, or paste a repo link.
                </p>
                <div className="flex gap-3">
                  <button 
                    className="flex items-center gap-2 px-3 py-2 border border-gray-300 hover:border-black text-sm font-ibm-plex-mono text-black"
                    onClick={(e) => {
                      e.preventDefault();
                      handleFileButtonClick();
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <Paperclip className="w-4 h-4" /> Add from a file
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelect}
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.md,.ppt,.pptx"
                  />
                  <button 
                    className="flex items-center gap-2 px-3 py-2 border border-gray-300 hover:border-black text-sm font-ibm-plex-mono text-black"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <Link className="w-4 h-4" /> Add from URL
                  </button>
                </div>
              </div>
              
              {/* Horizontal border */}
              <div className="border-t border-gray-200"></div>
              
              {/* Example suggestions */}
              <ul className="space-y-1">
                <li>
                  <button 
                    onClick={() => {
                      setInputValue("Seeking privacy founders — here's my pitch_deck");
                      setInputFocused(false);
                      inputRef.current?.blur();
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    className="w-full text-left text-sm text-gray-600 hover:text-black hover:bg-gray-50 font-ibm-plex-mono flex items-center gap-2 px-2 py-1 rounded"
                  >
                    Seeking privacy founders — here's my pitch_deck <span>📎</span>
                  </button>
                </li>
                <li>
                  <button 
                    onClick={() => {
                      setInputValue("Seeking early-stage investors strong fit to one_pager");
                      setInputFocused(false);
                      inputRef.current?.blur();
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    className="w-full text-left text-sm text-gray-600 hover:text-black hover:bg-gray-50 font-ibm-plex-mono flex items-center gap-2 px-2 py-1 rounded"
                  >
                    Seeking early-stage investors strong fit to one_pager <span>📎</span>
                  </button>
                </li>
                <li>
                  <button 
                    onClick={() => {
                      setInputValue("Agent infra devs for github.com/indexnetwork/index");
                      setInputFocused(false);
                      inputRef.current?.blur();
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    className="w-full text-left text-sm text-gray-600 hover:text-black hover:bg-gray-50 font-ibm-plex-mono flex items-center gap-2 px-2 py-1 rounded"
                  >
                    Agent infra devs for github.com/indexnetwork/index <span>🌐</span>
                  </button>
                </li>
              </ul>
              
              {/* Turn on Discovery - right aligned */}
              <div className="flex justify-end">
                <button 
                  className="flex items-center gap-2 px-3 py-2 bg-black border border-black hover:bg-gray-800 text-sm font-ibm-plex-mono text-white"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <span>🔍</span> Turn on Discovery
                </button>
              </div>
              </div>
            </div>
          )}
        </div>
        <button
          onClick={onRequestsClick}
          className="font-ibm-plex-mono px-4 py-3 border border-b-2 border-black bg-white hover:bg-gray-50 flex items-center gap-2 text-black whitespace-nowrap h-[54px]"
        >
          View Requests
          <span className="bg-black text-white text-xs px-2 py-1 rounded">
            {requestsCount}
          </span>
        </button>
      </div>
    </div>
  );
}

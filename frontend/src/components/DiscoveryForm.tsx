"use client";

import { useState, useRef, useEffect } from "react";

interface DiscoveryFormProps {
  onRequestsClick: () => void;
  requestsCount: number;
}

export default function DiscoveryForm({ onRequestsClick, requestsCount }: DiscoveryFormProps) {
  const [inputValue, setInputValue] = useState('');
  const [originalInputValue, setOriginalInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
      <div className="flex gap-4 items-stretch">
        <div className="flex-1 relative">
          <div className="bg-white border border-b-2 border-gray-800 flex items-center px-4 py-3">
            <input
              ref={inputRef}
              type="text"
              placeholder="What do you want to discover?"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (e.target.value === '') {
                  setInputFocused(false);
                } else {
                  setInputFocused(true);
                }
              }}
              onFocus={() => {
                setInputFocused(true);
                setOriginalInputValue(inputValue);
              }}
              onBlur={() => setTimeout(() => setInputFocused(false), 100)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setInputFocused(false);
                  inputRef.current?.blur();
                } else if (e.key === 'Escape') {
                  setInputValue(originalInputValue);
                  setInputFocused(false);
                  inputRef.current?.blur();
                }
              }}
              className="flex-1 text-lg font-ibm-plex-mono border-none focus:outline-none bg-transparent text-black placeholder-gray-500"
            />
          </div>
          
          {/* Dropdown content */}
          <div 
            className={`absolute top-full left-0 right-0 bg-white border border-t-0 border-b-2 border-gray-800 p-4 space-y-4 z-10 -mt-0.5 ${
              inputFocused ? 'block' : 'hidden'
            }`}
            onMouseDown={(e) => e.preventDefault()}
          >
              {/* Example suggestions */}
              <ul className="space-y-1">
                <li>
                  <button 
                    onClick={() => {
                      setInputValue("Seeking privacy founders — here's my pitch_deck");
                      setInputFocused(false);
                      inputRef.current?.blur();
                    }}
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
                    className="w-full text-left text-sm text-gray-600 hover:text-black hover:bg-gray-50 font-ibm-plex-mono flex items-center gap-2 px-2 py-1 rounded"
                  >
                    Agent infra devs for github.com/indexnetwork/index <span>🌐</span>
                  </button>
                </li>
              </ul>
              
              {/* Upload section */}
              <div className="border-t border-gray-200 pt-4 space-y-3">
                <p className="text-sm text-gray-600 font-ibm-plex-mono">
                  upload your pitch deck, one-pager, or paste a repo link.
                </p>
                <div className="flex gap-3">
                  <button className="flex items-center gap-2 px-3 py-2 border border-gray-300 hover:border-black text-sm font-ibm-plex-mono text-black">
                    <span>📄</span> Add from a file
                  </button>
                  <button className="flex items-center gap-2 px-3 py-2 border border-gray-300 hover:border-black text-sm font-ibm-plex-mono text-black">
                    <span>🔗</span> Add from URL
                  </button>
                </div>
              </div>
          </div>
        </div>
        <button
          onClick={onRequestsClick}
          className="font-ibm-plex-mono px-4 py-3 border border-b-2 border-black bg-white hover:bg-gray-50 flex items-center gap-2 text-black whitespace-nowrap"
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

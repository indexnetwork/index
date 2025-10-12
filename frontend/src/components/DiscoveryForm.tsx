"use client";

import { useState, useRef, useEffect } from "react";
import { Paperclip, X, Plus, Radio } from "lucide-react";

interface DiscoveryFormProps {
  onRequestsClick: () => void;
  requestsCount: number;
}

interface AttachmentItem {
  id: string;
  type: 'file';
  name: string;
  file: File;
}

export default function DiscoveryForm({ onRequestsClick, requestsCount }: DiscoveryFormProps) {
  const [inputFocused, setInputFocused] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isFileDialogOpen, setIsFileDialogOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingTimer = useRef<NodeJS.Timeout | null>(null);

  // URL regex - stops at spaces and invalid characters (including unicode spaces)
  const URLInTextRegex = /https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%]*)?/g;

  // HTML escape function
  const escapeHtml = (text: string) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  };

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const newAttachment: AttachmentItem = {
        id: Date.now().toString(),
        type: 'file',
        name: file.name,
        file: file
      };
      setAttachments(prev => [...prev, newAttachment]);
      
      // Insert attachment at cursor position
      insertAttachment(newAttachment);
      
      event.target.value = '';
    }
    setIsFileDialogOpen(false);
  };

  // Get display name for file
  const getDisplayName = (name: string) => {
    const nameWithoutExt = name.replace(/\.[^/.]+$/, '');
    const cleaned = nameWithoutExt.replace(/[_-]/g, ' ').trim();
    return cleaned.length > 20 ? cleaned.substring(0, 20) + '...' : cleaned;
  };

  // Insert attachment at cursor position
  const insertAttachment = (attachment: AttachmentItem) => {
    if (!contentRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    
    // Create attachment element with data attributes for reconstruction
    const attachmentElement = document.createElement('span');
    attachmentElement.className = 'attachment-tag inline-flex items-center gap-1 mx-1 px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-sm cursor-pointer hover:bg-gray-200';
    attachmentElement.contentEditable = 'false';
    attachmentElement.dataset.attachmentId = attachment.id;
    attachmentElement.dataset.attachmentName = attachment.name;
    attachmentElement.dataset.attachmentType = attachment.type;
    
    // Create attachment content
    attachmentElement.innerHTML = `
      📎 ${getDisplayName(attachment.name)}
      <svg class="w-3 h-3 text-red-500 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    `;

    // Insert at cursor position
    range.deleteContents();
    range.insertNode(attachmentElement);
    
    // Insert a zero-width space after attachment for cursor visibility
    const zwsp = document.createTextNode('\u200B');
    attachmentElement.parentNode?.insertBefore(zwsp, attachmentElement.nextSibling);
    
    // Move cursor after the zero-width space
    range.setStart(zwsp, 1);
    range.setEnd(zwsp, 1);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  // Remove attachment
  const removeAttachment = (attachmentId: string) => {
    // Remove from state
    setAttachments(prev => prev.filter(att => att.id !== attachmentId));
    
    // Remove from DOM
    if (contentRef.current) {
      const attachmentElement = contentRef.current.querySelector(`[data-attachment-id="${attachmentId}"]`);
      if (attachmentElement) {
        attachmentElement.remove();
      }
    }
  };

  // Save cursor position
  const saveSelection = () => {
    if (!contentRef.current || !window.getSelection) return null;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(contentRef.current);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const start = preSelectionRange.toString().length;

    return {
      start: start,
      end: start + range.toString().length
    };
  };

  // Restore cursor position
  const restoreSelection = (position: { start: number; end: number }) => {
    if (!contentRef.current || !position || !document.createRange || !window.getSelection) return;

    const range = document.createRange();
    range.setStart(contentRef.current, 0);
    range.collapse(true);

    let foundStart = false;
    let stop = false;
    let charIndex = 0;
    const nodeStack: ChildNode[] = [contentRef.current];

    while (!stop && nodeStack.length > 0) {
      const node = nodeStack.pop()!;
      
      if (node.nodeType === 1) { // element
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
          nodeStack.push(node.childNodes[i] as ChildNode);
        }
      } else if (node.nodeType === 3) { // text
        const nextCharIndex = charIndex + (node.textContent?.length || 0);
        if (!foundStart && position.start >= charIndex && position.start <= nextCharIndex) {
          range.setStart(node, position.start - charIndex);
          foundStart = true;
        }
        if (foundStart && position.end >= charIndex && position.end <= nextCharIndex) {
          range.setEnd(node, position.end - charIndex);
          stop = true;
        }
        charIndex = nextCharIndex;
      }
    }

    if (foundStart) {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };


  // Idle-based content processing to avoid constant DOM manipulation
  const scheduleContentProcessing = () => {
    if (processingTimer.current) {
      clearTimeout(processingTimer.current);
    }
    
    processingTimer.current = setTimeout(() => {
      processContent();
      processingTimer.current = null;
    }, 50); // Process after 500ms of inactivity
  };

  // Process content - only process text nodes, preserve attachments
  const processContent = () => {
    if (!contentRef.current) return;

    // Save cursor position
    const position = saveSelection();
    
    // First, unwrap any existing URL spans to reset them
    const existingUrlSpans = contentRef.current.querySelectorAll('.text-blue-500');
    existingUrlSpans.forEach(span => {
      const textNode = document.createTextNode(span.textContent || '');
      span.parentNode?.replaceChild(textNode, span);
    });
    
    // Walk through text nodes only, skipping attachments
    const walker = document.createTreeWalker(
      contentRef.current,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip text nodes inside attachment tags
          const parent = node.parentElement;
          if (parent?.classList.contains('attachment-tag')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes: Text[] = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node as Text);
    }

    // Process each text node for URLs
    textNodes.forEach(textNode => {
      const text = textNode.textContent || '';
      
      // Check if text contains URLs
      const matches = Array.from(text.matchAll(URLInTextRegex));
      
      if (matches.length > 0) {
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        
        // Process each URL match
        matches.forEach(match => {
          const url = match[0];
          const matchIndex = match.index ?? 0;
          const beforeUrl = text.slice(lastIndex, matchIndex);
          
          // Add text before URL as plain text
          if (beforeUrl) {
            fragment.appendChild(document.createTextNode(beforeUrl));
          }
          
          // Add URL as blue span (with exact URL text only)
          const urlSpan = document.createElement('span');
          urlSpan.className = 'text-blue-500';
          urlSpan.textContent = url; // Only the matched URL, nothing more
          fragment.appendChild(urlSpan);
          
          lastIndex = matchIndex + url.length;
        });
        
        // Add any remaining text after last URL
        if (lastIndex < text.length) {
          const remainingText = text.slice(lastIndex);
          if (remainingText) {
            fragment.appendChild(document.createTextNode(remainingText));
          }
        }
        
        // Replace the text node with the fragment
        if (fragment.hasChildNodes()) {
          textNode.parentNode?.replaceChild(fragment, textNode);
        }
      }
    });

    // Restore cursor position
    if (position) {
      setTimeout(() => restoreSelection(position), 0);
    }
  };



  // Trigger file input
  const handleFileButtonClick = () => {
    setIsFileDialogOpen(true);
    fileInputRef.current?.click();
  };

  // Auto-focus input on keypress
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Check if any modal is open by looking for modal elements
      const hasModalOpen = document.querySelector('[data-radix-dialog-content], [role="dialog"]') !== null;
      
      if (contentRef.current && !inputFocused && !hasModalOpen) {
        // Focus on Enter or when typing regular characters
        if (e.key === 'Enter' || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
          e.preventDefault();
          contentRef.current.focus();
          
          // Move cursor to the end of content
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(contentRef.current);
            range.collapse(false); // Collapse to end
            selection.removeAllRanges();
            selection.addRange(range);
            
            if (e.key.length === 1) {
              // Insert the character at the end
              const textNode = document.createTextNode(e.key);
              range.insertNode(textNode);
              range.setStartAfter(textNode);
              range.setEndAfter(textNode);
              selection.removeAllRanges();
              selection.addRange(range);
            }
            setInputFocused(true);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
      // Clean up processing timer
      if (processingTimer.current) {
        clearTimeout(processingTimer.current);
      }
    };
  }, [inputFocused]);

  return (
    <div className="space-y-4">
      {/* Input and button row */}
      <div className="flex gap-4 items-start">
        <div className="flex-1 relative">
          <div className="bg-white border border-b-2 border-gray-800 flex items-center px-4 py-2 min-h-[54px] relative">
            <div className="flex-1 relative">
              {/* ContentEditable div */}
              <div
                ref={contentRef}
                contentEditable
                suppressContentEditableWarning
                onInput={scheduleContentProcessing}
                onPaste={(e) => {
                  e.preventDefault();
                  // Get plain text from clipboard
                  const text = e.clipboardData?.getData('text/plain') || '';
                  
                  // Insert as plain text
                  const selection = window.getSelection();
                  if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    range.deleteContents();
                    const textNode = document.createTextNode(text);
                    range.insertNode(textNode);
                    
                    // Set cursor at the end of pasted text
                    range.setStartAfter(textNode);
                    range.setEndAfter(textNode);
                    selection.removeAllRanges();
                    selection.addRange(range);
                  }
                  
                  // Process for URLs after paste
                  setTimeout(() => {
                    processContent();
                  }, 0);
                }}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('.attachment-tag')) {
                    const attachmentElement = target.closest('.attachment-tag') as HTMLElement;
                    const attachmentId = attachmentElement.dataset.attachmentId;
                    if (attachmentId) {
                      e.preventDefault();
                      e.stopPropagation();
                      removeAttachment(attachmentId);
                    }
                  }
                }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => {
                  if (!isFileDialogOpen) {
                    setTimeout(() => setInputFocused(false), 100);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    setInputFocused(false);
                    contentRef.current?.blur();
                  } else if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    setInputFocused(true);
                  } else if (e.key === 'Escape') {
                    setInputFocused(false);
                    contentRef.current?.blur();
                  } else if (e.key === 'Backspace' || e.key === 'Delete') {
                    // Handle attachment deletion
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0 && selection.isCollapsed) {
                      const range = selection.getRangeAt(0);
                      const container = range.startContainer;
                      const offset = range.startOffset;
                      
                      if (e.key === 'Backspace') {
                        // Check if we're at the start of a text node right after an attachment
                        if (offset === 0 && container.nodeType === 3) {
                          const prevNode = container.previousSibling;
                          if (prevNode && (prevNode as Element).classList?.contains('attachment-tag')) {
                            e.preventDefault();
                            const attachmentId = (prevNode as Element).getAttribute('data-attachment-id');
                            if (attachmentId) {
                              removeAttachment(attachmentId);
                            }
                            return;
                          }
                        }
                        
                        // Check if we're deleting a zero-width space before an attachment
                        if (container.nodeType === 3 && offset > 0) {
                          const charBefore = (container as Text).textContent?.[offset - 1];
                          if (charBefore === '\u200B') {
                            // Check if there's an attachment before this zero-width space
                            const prevNode = container.previousSibling;
                            if (prevNode && (prevNode as Element).classList?.contains('attachment-tag')) {
                              e.preventDefault();
                              const attachmentId = (prevNode as Element).getAttribute('data-attachment-id');
                              if (attachmentId) {
                                removeAttachment(attachmentId);
                              }
                              return;
                            }
                          }
                        }
                      } else if (e.key === 'Delete') {
                        // Check if we're at the end of a text node right before an attachment
                        if (container.nodeType === 3) {
                          const textLength = (container as Text).textContent?.length || 0;
                          if (offset === textLength) {
                            const nextNode = container.nextSibling;
                            if (nextNode && (nextNode as Element).classList?.contains('attachment-tag')) {
                              e.preventDefault();
                              const attachmentId = (nextNode as Element).getAttribute('data-attachment-id');
                              if (attachmentId) {
                                removeAttachment(attachmentId);
                              }
                              return;
                            }
                          }
                        }
                      }
                    }
                  }
                }}
                className="text-lg font-ibm-plex-mono text-black min-h-[24px] py-1 focus:outline-none"
                style={{ 
                  lineHeight: '1.5',
                  wordBreak: 'break-word'
                }}
                data-placeholder="What do you want to discover?"
              />
              
              {/* Placeholder styling */}
              <style jsx>{`
                [contenteditable][data-placeholder]:empty::before {
                  content: attr(data-placeholder);
                  color: #6b7280;
                  pointer-events: none;
                }
              `}</style>
            </div>
            
            {attachments.length > 0 && (
              <div className="flex items-center gap-1 text-gray-600 ml-2">
                <Paperclip className="w-4 h-4" />
                <span className="text-sm font-ibm-plex-mono">{attachments.length}</span>
              </div>
            )}
            
            {/* Dropdown when focused */}
            {inputFocused && (
               <div className="absolute top-full left-0 right-0 bg-white border-l border-r border-b border-gray-800 z-[9999] shadow-lg" style={{
                 marginLeft: '-1px',
                 marginRight: '-1px',
               }}>
                <div className="px-4 pb-4 pt-2 space-y-4">
                  {/* Upload section */}
                  <div className="flex items-center gap-3">
                    <button 
                      className="flex items-center gap-2 px-3 py-2 border border-gray-300 hover:border-black text-sm font-ibm-plex-mono text-black"
                      onClick={handleFileButtonClick}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <Paperclip className="w-4 h-4" />
                      <span className="hidden sm:inline">Add from a file</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileSelect}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.txt,.md,.ppt,.pptx"
                    />
                    <p className="text-xs text-gray-500 font-ibm-plex-mono">
                      upload your pitch deck, one-pager, or paste a link.
                    </p>
                  </div>
                  
                  {/* Horizontal border */}
                  <div className="border-t border-gray-200"></div>
                  
                  {/* Example suggestions */}
                  <ul className="space-y-1">
                    <li>
                      <button 
                        onClick={() => {
                          if (contentRef.current) {
                            contentRef.current.textContent = "Seeking privacy founders — here's my pitch_deck";
                            setInputFocused(false);
                            contentRef.current.blur();
                          }
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
                          if (contentRef.current) {
                            contentRef.current.textContent = "Seeking early-stage investors strong fit to one_pager";
                            setInputFocused(false);
                            contentRef.current.blur();
                          }
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
                          if (contentRef.current) {
                            contentRef.current.textContent = "Agent infra devs for github.com/indexnetwork/index";
                            setInputFocused(false);
                            contentRef.current.blur();
                          }
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
                      <Radio className="w-4 h-4" /> Turn on Discovery
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
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

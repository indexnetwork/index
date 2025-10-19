"use client";

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Paperclip, Radio } from "lucide-react";
import { useAPI } from "@/contexts/APIContext";
import { usePrivy } from "@privy-io/react-auth";
import { useNotifications } from "@/contexts/NotificationContext";
import { validateFiles, getSupportedFileExtensions } from "../lib/file-validation";

interface DiscoveryFormProps {
  onSubmit?: (intents: Array<{id: string; payload: string; summary?: string; createdAt: string}>) => void;
}

interface AttachmentItem {
  id: string;
  type: 'file';
  name: string;
  file: File;
}

export interface DiscoveryFormRef {
  handleFileDrop: (files: FileList) => void;
}

const DiscoveryForm = forwardRef<DiscoveryFormRef, DiscoveryFormProps>(({ onSubmit }, ref) => {
  const [inputFocused, setInputFocused] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isFileDialogOpen, setIsFileDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recentIntents, setRecentIntents] = useState<Array<{id: string; payload: string; summary: string | null; createdAt: Date}>>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingTimer = useRef<NodeJS.Timeout | null>(null);
  const undoStack = useRef<Array<{html: string; attachments: AttachmentItem[]; cursorPos: {start: number; end: number} | null}>>([]);
  const redoStack = useRef<Array<{html: string; attachments: AttachmentItem[]; cursorPos: {start: number; end: number} | null}>>([]);
  const isUndoRedoing = useRef(false);
  const { discoverService, intentsService } = useAPI();
  const { getAccessToken } = usePrivy();
  const { success, error } = useNotifications();

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    handleFileDrop: (files: FileList) => {
      if (files.length > 0) {
        const file = files[0];
        
        // Validate combined file set
        const nextFiles = [...attachments.map(a => a.file), file];
        const validation = validateFiles(nextFiles, 'general');
        if (!validation.isValid) {
          error(validation.message || 'Invalid file');
          return;
        }
        
        const newAttachment: AttachmentItem = {
          id: Date.now().toString(),
          type: 'file',
          name: file.name,
          file: file
        };
        setAttachments(prev => [...prev, newAttachment]);
        setInputFocused(true);
        
        // Insert attachment at cursor position
        setTimeout(() => {
          contentRef.current?.focus();
          insertAttachment(newAttachment);
        }, 0);
      }
    }
  }));

  // URL regex - stops at spaces and invalid characters (including unicode spaces)
  const URLInTextRegex = /https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%]*)?/g;

  // Save current state to undo stack
  const saveToUndoStack = () => {
    if (isUndoRedoing.current || !contentRef.current) return;
    
    const currentHtml = contentRef.current.innerHTML;
    const currentCursorPos = saveSelection();
    const currentAttachments = JSON.parse(JSON.stringify(attachments)); // Deep copy
    
    undoStack.current.push({
      html: currentHtml,
      attachments: currentAttachments,
      cursorPos: currentCursorPos
    });
    
    // Limit undo stack size to 50
    if (undoStack.current.length > 50) {
      undoStack.current.shift();
    }
    
    // Clear redo stack when new action is performed
    redoStack.current = [];
  };

  // Undo operation
  const performUndo = () => {
    if (undoStack.current.length === 0 || !contentRef.current) return;
    
    isUndoRedoing.current = true;
    
    // Save current state to redo stack
    const currentHtml = contentRef.current.innerHTML;
    const currentCursorPos = saveSelection();
    const currentAttachments = JSON.parse(JSON.stringify(attachments));
    
    redoStack.current.push({
      html: currentHtml,
      attachments: currentAttachments,
      cursorPos: currentCursorPos
    });
    
    // Pop from undo stack and restore
    const previousState = undoStack.current.pop();
    if (previousState) {
      contentRef.current.innerHTML = previousState.html;
      setAttachments(previousState.attachments);
      
      // Focus and restore cursor position
      contentRef.current.focus();
      if (previousState.cursorPos) {
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          restoreSelection(previousState.cursorPos!);
        });
      } else {
        // If no cursor position saved, move to end
        requestAnimationFrame(() => {
          const selection = window.getSelection();
          if (selection && contentRef.current) {
            const range = document.createRange();
            range.selectNodeContents(contentRef.current);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        });
      }
    }
    
    isUndoRedoing.current = false;
  };

  // Redo operation
  const performRedo = () => {
    if (redoStack.current.length === 0 || !contentRef.current) return;
    
    isUndoRedoing.current = true;
    
    // Save current state to undo stack
    const currentHtml = contentRef.current.innerHTML;
    const currentCursorPos = saveSelection();
    const currentAttachments = JSON.parse(JSON.stringify(attachments));
    
    undoStack.current.push({
      html: currentHtml,
      attachments: currentAttachments,
      cursorPos: currentCursorPos
    });
    
    // Pop from redo stack and restore
    const nextState = redoStack.current.pop();
    if (nextState) {
      contentRef.current.innerHTML = nextState.html;
      setAttachments(nextState.attachments);
      
      // Focus and restore cursor position
      contentRef.current.focus();
      if (nextState.cursorPos) {
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          restoreSelection(nextState.cursorPos!);
        });
      } else {
        // If no cursor position saved, move to end
        requestAnimationFrame(() => {
          const selection = window.getSelection();
          if (selection && contentRef.current) {
            const range = document.createRange();
            range.selectNodeContents(contentRef.current);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        });
      }
    }
    
    isUndoRedoing.current = false;
  };

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate combined file set to enforce cumulative limits
      const nextFiles = [...attachments.map(a => a.file), file];
      const validation = validateFiles(nextFiles, 'general');
      if (!validation.isValid) {
        error(validation.message || 'Invalid file');
        event.target.value = '';
        setIsFileDialogOpen(false);
        return;
      }
      
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
    let charIndex = 0;
    let foundStart = false;
    let foundEnd = false;
    
    // Helper function to traverse all text nodes
    const traverseNodes = (node: Node): boolean => {
      if (foundEnd) return true;
      
      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        const textLength = textNode.textContent?.length || 0;
        const nextCharIndex = charIndex + textLength;
        
        if (!foundStart && position.start >= charIndex && position.start <= nextCharIndex) {
          range.setStart(textNode, Math.min(position.start - charIndex, textLength));
          foundStart = true;
        }
        
        if (foundStart && position.end >= charIndex && position.end <= nextCharIndex) {
          range.setEnd(textNode, Math.min(position.end - charIndex, textLength));
          foundEnd = true;
          return true;
        }
        
        charIndex = nextCharIndex;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // Skip attachment tags when counting characters
        if ((node as Element).classList?.contains('attachment-tag')) {
          return false;
        }
        
        for (let i = 0; i < node.childNodes.length; i++) {
          if (traverseNodes(node.childNodes[i])) {
            return true;
          }
        }
      }
      
      return false;
    };

    traverseNodes(contentRef.current);

    // If we found a valid range, apply it
    if (foundStart) {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else {
      // Fallback: place cursor at the end
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(contentRef.current);
        range.collapse(false);
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

  // Handle discovery submission
  const handleDiscoverySubmit = async () => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    
    try {
      // Get text content from contentEditable div
      const textContent = contentRef.current?.innerText || '';
      
      // Get files from attachments
      const files = attachments.map(att => att.file);
      
      // Validate that we have either files or text
      if (files.length === 0 && !textContent.trim()) {
        error('Please add files or enter text to start discovery');
        setIsProcessing(false);
        return;
      }
      
      // Submit discovery request
      const result = await discoverService.submitDiscoveryRequest(files, textContent)(getAccessToken);
      
      if (result.success && result.intents.length > 0) {
        success(`Got the signal! Passing it along to the right folks, let's see what unfolds.`);
        
        // Clear only attachments, keep the text
        setAttachments([]);
        setInputFocused(false);
        contentRef.current?.blur();
        
        // Trigger discovery with generated intents
        if (onSubmit) {
          onSubmit(result.intents);
        }
      } else {
        error('Failed to generate intents. Please try again.');
      }
    } catch (err) {
      console.error('Discovery request failed:', err);
      error(err instanceof Error ? err.message : 'Failed to process discovery request');
    } finally {
      setIsProcessing(false);
    }
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

  // Close input when any modal opens
  useEffect(() => {
    const checkForModals = () => {
      const hasModalOpen = document.querySelector('[data-radix-dialog-content], [role="dialog"]') !== null;
      
      if (hasModalOpen && inputFocused) {
        // Modal is open and input is focused, close it
        setInputFocused(false);
        contentRef.current?.blur();
      }
    };

    // Check immediately
    checkForModals();

    // Use MutationObserver to detect when modals are added to the DOM
    const observer = new MutationObserver(checkForModals);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [inputFocused]);

  // Fetch recent discovery intents when input is focused
  useEffect(() => {
    if (inputFocused && recentIntents.length === 0) {
      const fetchRecentIntents = async () => {
        try {
          const response = await intentsService.getIntents(1, 3, false, undefined, 'discovery_form');
          if (response.intents) {
            setRecentIntents(response.intents.map(intent => ({
              id: intent.id,
              payload: intent.payload,
              summary: intent.summary ?? null,
              createdAt: new Date(intent.createdAt)
            })));
          }
        } catch (err) {
          console.error('Failed to fetch recent discovery intents:', err);
        }
      };
      fetchRecentIntents();
    }
  }, [inputFocused, recentIntents.length, intentsService]);

  return (
    <div className="relative">
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
                  
                  // Save state before paste
                  saveToUndoStack();
                  
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
                onKeyDown={async (e) => {
                  // Handle undo (Cmd+Z or Ctrl+Z)
                  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    performUndo();
                    return;
                  }
                  
                  // Handle redo (Cmd+Shift+Z or Ctrl+Shift+Z)
                  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
                    e.preventDefault();
                    performRedo();
                    return;
                  }
                  
                  // Save state before any modification
                  if (!e.metaKey && !e.ctrlKey && e.key.length === 1) {
                    saveToUndoStack();
                  }
                  
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    await handleDiscoverySubmit();
                  } else if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    setInputFocused(true);
                  } else if (e.key === 'Escape') {
                    setInputFocused(false);
                    contentRef.current?.blur();
                  } else if (e.key === 'Backspace' || e.key === 'Delete') {
                    // Save state before deletion
                    saveToUndoStack();
                    
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
            
            <div className="flex items-center gap-2 ml-2">
              {attachments.length > 0 && (
                <div className="flex items-center gap-1 text-gray-600">
                  <Paperclip className="w-4 h-4" />
                  <span className="text-sm font-ibm-plex-mono">{attachments.length}</span>
                </div>
              )}
            </div>
            
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
                      accept={getSupportedFileExtensions('general')}
                    />
                    <p className="text-xs text-gray-500 font-ibm-plex-mono">
                      upload your pitch deck, one-pager, or paste a link.
                    </p>
                  </div>
                  
                  {/* Recent discovery intents */}
                  {recentIntents.length > 0 && (
                    <>
                      {/* Horizontal border */}
                      <div className="border-t border-gray-200"></div>
                      
                      <ul className="space-y-1">
                        {recentIntents.map((intent) => (
                          <li key={intent.id}>
                            <button 
                              onClick={() => {
                                // Set the intent as a filter
                                if (onSubmit) {
                                  onSubmit([{
                                    id: intent.id,
                                    payload: intent.payload,
                                    summary: intent.summary || undefined,
                                    createdAt: intent.createdAt.toISOString()
                                  }]);
                                }
                                setInputFocused(false);
                                contentRef.current?.blur();
                              }}
                              onMouseDown={(e) => e.preventDefault()}
                              className="w-full text-left text-sm text-gray-600 hover:text-black hover:bg-gray-50 font-ibm-plex-mono flex items-center gap-2 px-2 py-1 rounded"
                            >
                              {intent.summary || intent.payload}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  
                  {/* Turn on Discovery - right aligned */}
                  <div className="flex justify-end">
                    <button 
                      className="flex items-center gap-2 px-3 py-2 bg-black border border-black hover:bg-gray-800 text-sm font-ibm-plex-mono text-white disabled:opacity-50 disabled:cursor-not-allowed"
                      onMouseDown={(e) => e.preventDefault()}
                      disabled={isProcessing}
                      onClick={handleDiscoverySubmit}
                    >
                      {isProcessing ? (
                        <>
                          <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                          Signal processing
                        </>
                      ) : (
                        <>
                          <Radio className="w-4 h-4" /> Turn on Discovery
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
      </div>
    </div>
  );
});

DiscoveryForm.displayName = 'DiscoveryForm';

export default DiscoveryForm;

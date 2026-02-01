"use client";

import { forwardRef, useImperativeHandle, useRef, useState, useCallback, useEffect } from "react";
import { useAPI } from "@/contexts/APIContext";
import { IntentAction } from "@/services/discover";
import { usePrivy } from "@privy-io/react-auth";
import { useNotifications } from "@/contexts/NotificationContext";
import { validateFiles, getSupportedFileExtensions, getFileCategoryBadge } from "@/lib/file-validation";
import { ArrowUp, X, Loader2, Zap, Type, AtSign } from "lucide-react";
import Image from "next/image";
import { Intent } from "@/types";

export interface Suggestion {
  label: string;
  type: 'direct' | 'prompt' | 'memberFilter';
  followupText?: string;  // For direct type
  prefill?: string;       // For prompt type
}

export interface MentionUser {
  id: string;
  name: string;
  avatar?: string | null;
}

interface DiscoveryFormProps {
  onSubmit?: (intents: Array<{ id: string; payload: string; summary?: string; createdAt: string }>, actions?: IntentAction[]) => void;
  onRefine?: (intent: Intent) => void;
  intentId?: string; // When provided, form operates in refine mode
  floating?: boolean; // If true, renders as fixed floating at bottom; if false, renders inline
  // Mention support props
  enableMentions?: boolean;
  onMentionSearch?: (query: string) => Promise<MentionUser[]>;
  mentions?: MentionUser[];
  onMentionsChange?: (mentions: MentionUser[]) => void;
  // Custom submit for admin mode
  onPromptSubmit?: (prompt: string, mentions: MentionUser[]) => void;
  placeholder?: string;
  // Parent-provided suggestions
  suggestions?: Suggestion[];
}

export interface DiscoveryFormRef {
  handleFileDrop: (files: FileList) => void;
  focus: () => void;
}

interface Attachment {
  id: string;
  file: File;
  preview?: string;
}

const LOADING_STATES = [
  { message: "Thinking", color: "bg-amber-400" },
  { message: "Understanding what you're looking for", color: "bg-blue-400" },
  { message: "Registering your intent", color: "bg-green-400" },
];

const DiscoveryForm = forwardRef<DiscoveryFormRef, DiscoveryFormProps>(({ 
  onSubmit, 
  onRefine, 
  intentId, 
  floating = false,
  enableMentions = false,
  onMentionSearch,
  mentions = [],
  onMentionsChange,
  onPromptSubmit,
  placeholder,
  suggestions: parentSuggestions
}, ref) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fetchedSuggestions, setFetchedSuggestions] = useState<Suggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [applyingSuggestionIndex, setApplyingSuggestionIndex] = useState<number | null>(null);
  // Mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<MentionUser[]>([]);
  const [isMentionLoading, setIsMentionLoading] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);
  
  const { discoverService, intentsService } = useAPI();
  const { getAccessToken } = usePrivy();
  const { error } = useNotifications();
  const inputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<string[]>([]);
  
  // Track mention positions for atomic deletion
  const mentionMapRef = useRef<Map<string, MentionUser>>(new Map());
  
  // Get plain text from contentEditable
  const getPlainText = useCallback(() => {
    if (!inputRef.current) return '';
    return inputRef.current.innerText || '';
  }, []);
  
  // Extract mentions from contentEditable
  const extractMentions = useCallback((): MentionUser[] => {
    if (!inputRef.current) return [];
    const mentionSpans = inputRef.current.querySelectorAll('[data-mention-id]');
    const extractedMentions: MentionUser[] = [];
    mentionSpans.forEach(span => {
      const id = span.getAttribute('data-mention-id');
      const user = mentionMapRef.current.get(id || '');
      if (user) {
        extractedMentions.push(user);
      }
    });
    return extractedMentions;
  }, []);
  
  // Set cursor position in contentEditable
  const setCursorToEnd = useCallback(() => {
    if (!inputRef.current) return;
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(inputRef.current);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);
  
  // Insert mention span at current cursor position
  const insertMentionSpan = useCallback((user: MentionUser, replaceLength: number) => {
    if (!inputRef.current) return;
    
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    
    const range = sel.getRangeAt(0);
    
    // Delete the @query text
    if (replaceLength > 0) {
      range.setStart(range.startContainer, Math.max(0, range.startOffset - replaceLength));
      range.deleteContents();
    }
    
    // Create mention span
    const mentionSpan = document.createElement('span');
    mentionSpan.className = 'text-blue-600 font-medium';
    mentionSpan.setAttribute('data-mention-id', user.id);
    mentionSpan.setAttribute('contenteditable', 'false');
    mentionSpan.textContent = `@${user.name}`;
    
    // Insert mention span
    range.insertNode(mentionSpan);
    
    // Add a space after
    const space = document.createTextNode(' ');
    mentionSpan.parentNode?.insertBefore(space, mentionSpan.nextSibling);
    
    // Move cursor after the space
    range.setStartAfter(space);
    range.setEndAfter(space);
    sel.removeAllRanges();
    sel.addRange(range);
    
    // Store in map
    mentionMapRef.current.set(user.id, user);
  }, []);

  // In refine mode (intentId provided), fetch suggestions
  useEffect(() => {
    if (!intentId) {
      setFetchedSuggestions([]);
      return;
    }

    const fetchSuggestions = async () => {
      setIsLoadingSuggestions(true);
      try {
        const result = await intentsService.getIntentSuggestions(intentId);
        setFetchedSuggestions(result);
      } catch (err) {
        console.error('Failed to fetch suggestions:', err);
        setFetchedSuggestions([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    };

    fetchSuggestions();
  }, [intentId, intentsService]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    handleFileDrop: (files: FileList) => {
      handleFiles(Array.from(files));
    },
    focus: () => {
      inputRef.current?.focus();
    }
  }));

  const handleFiles = useCallback((files: File[]) => {
    // Validate combined file set
    const nextFiles = [...attachments.map(a => a.file), ...files];
    const validation = validateFiles(nextFiles, 'general');
    if (!validation.isValid) {
      error(validation.message || 'Invalid file');
      return;
    }

    const newAttachments: Attachment[] = files.map(file => {
      const id = `${Date.now()}-${Math.random()}`;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      if (preview) {
        previewUrlsRef.current.push(preview);
      }
      return { id, file, preview };
    });

    setAttachments(prev => [...prev, ...newAttachments]);
    inputRef.current?.focus();
  }, [attachments, error]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(Array.from(files));
      e.target.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const attachment = prev.find(a => a.id === id);
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
        previewUrlsRef.current = previewUrlsRef.current.filter(url => url !== attachment.preview);
      }
      return prev.filter(a => a.id !== id);
    });
  };

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach(url => {
        URL.revokeObjectURL(url);
      });
      previewUrlsRef.current = [];
    };
  }, []);

  // Animate loading messages while processing
  useEffect(() => {
    if (!isProcessing) {
      setLoadingMessageIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingMessageIndex(i => Math.min(i + 1, LOADING_STATES.length - 1));
    }, 2000);
    return () => clearInterval(interval);
  }, [isProcessing]);

  // Mention search effect
  useEffect(() => {
    if (!enableMentions || !onMentionSearch || mentionQuery === null) {
      // Only update if there are results to clear
      if (mentionResults.length > 0) {
        setMentionResults([]);
      }
      return;
    }

    const searchMentions = async () => {
      setIsMentionLoading(true);
      try {
        // Search with the query (empty string returns initial/all members)
        const results = await onMentionSearch(mentionQuery);
        // Filter out already mentioned users
        const filteredResults = results.filter(
          r => !mentions.some(m => m.id === r.id)
        );
        setMentionResults(filteredResults);
        setSelectedMentionIndex(0);
      } catch (err) {
        console.error('Mention search failed:', err);
        setMentionResults([]);
      } finally {
        setIsMentionLoading(false);
      }
    };

    const timeoutId = setTimeout(searchMentions, 200);
    return () => clearTimeout(timeoutId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionQuery, enableMentions, onMentionSearch, mentions]);

  // Handle contentEditable input with @ detection
  const handleContentInput = useCallback(() => {
    if (!inputRef.current || !enableMentions) return;
    
    const text = getPlainText();
    setInputValue(text);
    
    // Detect @ mention at cursor
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    
    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    
    // Only detect in text nodes (not inside mention spans)
    if (textNode.nodeType !== Node.TEXT_NODE) {
      setMentionQuery(null);
      return;
    }
    
    const textContent = textNode.textContent || '';
    const cursorPos = range.startOffset;
    const textBeforeCursor = textContent.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    
    if (atMatch) {
      setMentionQuery(atMatch[1]);
    } else {
      setMentionQuery(null);
    }
  }, [enableMentions, getPlainText]);

  // Handle selecting a mention
  const handleSelectMention = useCallback((user: MentionUser) => {
    if (!inputRef.current) return;
    
    // Get text before cursor to find @query length
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    
    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    
    if (textNode.nodeType === Node.TEXT_NODE) {
      const textContent = textNode.textContent || '';
      const cursorPos = range.startOffset;
      const textBeforeCursor = textContent.slice(0, cursorPos);
      const atMatch = textBeforeCursor.match(/@(\w*)$/);
      
      if (atMatch) {
        // Replace @query with mention span
        insertMentionSpan(user, atMatch[0].length);
      }
    }
    
    // Add to mentions (sync with parent)
    if (onMentionsChange) {
      onMentionsChange([...mentions, user]);
    }
    
    setMentionQuery(null);
    setMentionResults([]);
    setInputValue(getPlainText());
    inputRef.current?.focus();
  }, [insertMentionSpan, mentions, onMentionsChange, getPlainText]);

  // Remove a mention (from both DOM and parent state)
  const handleRemoveMention = useCallback((userId: string) => {
    // Remove from DOM
    if (inputRef.current) {
      const mentionSpan = inputRef.current.querySelector(`[data-mention-id="${userId}"]`);
      if (mentionSpan) {
        mentionSpan.remove();
      }
    }
    // Remove from map
    mentionMapRef.current.delete(userId);
    // Update parent
    if (onMentionsChange) {
      onMentionsChange(mentions.filter(m => m.id !== userId));
    }
    setInputValue(getPlainText());
  }, [mentions, onMentionsChange, getPlainText]);

  // Handle refining intent with followup text
  const handleRefine = async (followupText: string) => {
    if (!intentId || isProcessing) return;

    setIsProcessing(true);
    setInputValue("");

    try {
      const refinedIntent = await intentsService.refineIntent(intentId, followupText);

      if (onRefine) {
        onRefine(refinedIntent);
      }

      // Refresh suggestions after refining
      try {
        const newSuggestions = await intentsService.getIntentSuggestions(intentId);
        setFetchedSuggestions(newSuggestions);
      } catch {
        // Ignore suggestion refresh errors
      }
    } catch (err) {
      console.error('Refine intent failed:', err);
      error(err instanceof Error ? err.message : 'Failed to refine intent');
    } finally {
      setIsProcessing(false);
      setApplyingSuggestionIndex(null);
    }
  };

  // Handle suggestion chip click
  const handleSuggestionClick = async (suggestion: Suggestion, index: number) => {
    if (isProcessing) return;

    if (suggestion.type === 'prompt' && suggestion.prefill) {
      // Prefill contentEditable and focus for user to complete
      if (inputRef.current) {
        inputRef.current.textContent = suggestion.prefill;
        setInputValue(suggestion.prefill);
        inputRef.current.focus();
        setCursorToEnd();
      }
    } else if (suggestion.type === 'direct' && suggestion.followupText) {
      // Apply directly - use onPromptSubmit if available (admin mode), otherwise refine
      setApplyingSuggestionIndex(index);
      if (onPromptSubmit) {
        setIsProcessing(true);
        try {
          await onPromptSubmit(suggestion.followupText, mentions);
        } finally {
          setIsProcessing(false);
          setApplyingSuggestionIndex(null);
        }
      } else {
        await handleRefine(suggestion.followupText);
      }
    } else if (suggestion.type === 'memberFilter') {
      // Trigger @ mention dropdown - insert @ and open dropdown
      if (inputRef.current) {
        inputRef.current.focus();
        // Insert @ at cursor position
        document.execCommand('insertText', false, '@');
        setInputValue(getPlainText());
        setMentionQuery('');
      }
    }
  };

  const handleSubmit = async () => {
    const text = getPlainText().trim();
    if (isProcessing || (!text && attachments.length === 0)) return;

    // Extract mentions from contentEditable
    const currentMentions = extractMentions();

    // If in refine mode (intentId provided), use refine flow
    if (intentId && text) {
      await handleRefine(text);
      return;
    }

    // If using onPromptSubmit (admin mode), use that instead
    if (onPromptSubmit) {
      setIsProcessing(true);
      try {
        await onPromptSubmit(text, currentMentions);
        // Clear contentEditable
        if (inputRef.current) {
          inputRef.current.innerHTML = '';
        }
        setInputValue("");
        mentionMapRef.current.clear();
        if (onMentionsChange) {
          onMentionsChange([]);
        }
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    const files = attachments.map(a => a.file);

    // Clean up preview URLs
    attachments.forEach(attachment => {
      if (attachment.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
    });
    previewUrlsRef.current = [];

    // Clear contentEditable
    if (inputRef.current) {
      inputRef.current.innerHTML = '';
    }
    setInputValue("");
    setAttachments([]);
    mentionMapRef.current.clear();
    if (onMentionsChange) {
      onMentionsChange([]);
    }
    setIsProcessing(true);

    try {
      // Submit discovery request with text and files
      const result = await discoverService.submitDiscoveryRequest(files, text || undefined)(getAccessToken);

      if (onSubmit) {
        // If we have explicit actions (from IntentManager), pass them
        // Even if success is true, we might have 0 intents if the action was 'expire'
        onSubmit(result.intents, result.actions);
      }

      if (!result.success) {
        error('Failed to generate intents. Please try again.');
      }
    } catch (err) {
      console.error('Discovery request failed:', err);
      error(err instanceof Error ? err.message : 'Failed to process discovery request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(Array.from(files));
    }
  };

  // Combine parent suggestions with fetched suggestions
  const allSuggestions = [
    ...(parentSuggestions || []),
    ...(intentId ? fetchedSuggestions : [])
  ];

  const formContent = (
    <>
      {/* Suggestion chips */}
      {(allSuggestions.length > 0 || isLoadingSuggestions) && (
        <div className="px-3 pt-2 pb-1 flex gap-1.5 overflow-x-auto scrollbar-hide">
          {isLoadingSuggestions ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="font-ibm-plex-mono text-xs">Loading...</span>
            </div>
          ) : (
            allSuggestions.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(suggestion, index)}
                disabled={isProcessing}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-card border border-border rounded-full text-xs font-ibm-plex-mono text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
              >
                {applyingSuggestionIndex === index ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : suggestion.type === 'direct' ? (
                  <Zap className="w-3 h-3" />
                ) : suggestion.type === 'memberFilter' ? (
                  <AtSign className="w-3 h-3" />
                ) : (
                  <Type className="w-3 h-3" />
                )}
                {suggestion.label}
              </button>
            ))
          )}
        </div>
      )}

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="px-3 pt-2 pb-1 flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group inline-flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1 hover:border-muted-foreground transition-colors"
            >
              {attachment.preview ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={attachment.preview}
                  alt={attachment.file.name}
                  className="w-4 h-4 object-cover rounded"
                />
              ) : (
                <div className="px-2 py-0.5 bg-muted rounded flex items-center justify-center">
                  <span className="text-[8px] font-ibm-plex-mono text-muted-foreground font-bold">
                    {getFileCategoryBadge(attachment.file.name)}
                  </span>
                </div>
              )}
              <span className="text-xs font-ibm-plex-mono text-foreground">
                {attachment.file.name}
              </span>
              <button
                onClick={() => removeAttachment(attachment.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                aria-label="Remove attachment"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="relative flex items-center px-3 py-2 min-h-[48px]">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={getSupportedFileExtensions('general')}
          onChange={handleFileSelect}
        />
        <div
          ref={inputRef}
          contentEditable={!isProcessing}
          onInput={handleContentInput}
          onKeyDown={(e) => {
            // Handle mention navigation
            if (mentionQuery !== null && mentionResults.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedMentionIndex(i => Math.min(i + 1, mentionResults.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedMentionIndex(i => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                handleSelectMention(mentionResults[selectedMentionIndex]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMentionQuery(null);
                return;
              }
            }
            
            // Atomic backspace deletion for mentions
            if (e.key === 'Backspace') {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                if (range.collapsed) {
                  // Check if cursor is right after a mention span
                  const container = range.startContainer;
                  const offset = range.startOffset;
                  
                  // If at start of a text node that follows a mention
                  if (container.nodeType === Node.TEXT_NODE && offset === 0) {
                    const prevSibling = container.previousSibling;
                    if (prevSibling && prevSibling instanceof HTMLElement && prevSibling.hasAttribute('data-mention-id')) {
                      e.preventDefault();
                      const mentionId = prevSibling.getAttribute('data-mention-id');
                      if (mentionId) {
                        handleRemoveMention(mentionId);
                      }
                      return;
                    }
                  }
                  
                  // If cursor is at the boundary right after mention span
                  if (container === inputRef.current && offset > 0) {
                    const child = inputRef.current.childNodes[offset - 1];
                    if (child instanceof HTMLElement && child.hasAttribute('data-mention-id')) {
                      e.preventDefault();
                      const mentionId = child.getAttribute('data-mention-id');
                      if (mentionId) {
                        handleRemoveMention(mentionId);
                      }
                      return;
                    }
                  }
                }
              }
            }
            
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          onPaste={(e) => {
            // Paste as plain text only
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
          }}
          data-placeholder={placeholder || (intentId ? "Ask a follow-up question..." : (floating ? "Ask a follow-up question..." : "What's your most important work?"))}
          className={`flex-1 font-ibm-plex-mono text-foreground ${floating ? 'text-md' : 'text-lg'} focus:outline-none bg-transparent min-h-[24px] empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground ${isProcessing ? 'opacity-0 pointer-events-none' : ''}`}
          suppressContentEditableWarning
        />
        
        {/* Loading indicator with colored dot */}
        {isProcessing && (
          <div className="absolute inset-0 flex items-center px-3 pointer-events-none">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${LOADING_STATES[loadingMessageIndex].color} animate-pulse`} />
              <span className="font-ibm-plex-mono text-muted-foreground text-sm">
                {LOADING_STATES[loadingMessageIndex].message}
              </span>
            </div>
          </div>
        )}
        
        {/* Mention dropdown */}
        {enableMentions && mentionQuery !== null && (mentionResults.length > 0 || isMentionLoading) && (
          <div 
            ref={mentionDropdownRef}
            className="absolute left-3 right-3 bottom-full mb-1 bg-card border border-border rounded-md shadow-lg dark:shadow-none max-h-48 overflow-y-auto z-50"
          >
            {isMentionLoading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground font-ibm-plex-mono flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Searching...
              </div>
            ) : (
              mentionResults.map((user, index) => (
                <button
                  key={user.id}
                  onClick={() => handleSelectMention(user)}
                  className={`w-full px-3 py-2 text-left text-sm font-ibm-plex-mono flex items-center gap-2 transition-colors ${
                    index === selectedMentionIndex ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                >
                  {user.avatar && (
                    <Image src={user.avatar} alt="" width={20} height={20} className="w-5 h-5 rounded-full" unoptimized />
                  )}
                  <span className="text-foreground">{user.name}</span>
                </button>
              ))
            )}
          </div>
        )}
        {isProcessing ? (
          <button
            onClick={() => setIsProcessing(false)}
            className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-colors cursor-pointer ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={intentId ? !inputValue.trim() : (!inputValue.trim() && attachments.length === 0)}
            className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ml-2"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        )}
      </div>
    </>
  );

  const formClasses = floating
    ? "bg-card border border-foreground rounded-sm shadow-lg dark:shadow-none flex flex-col"
    : "w-full bg-card border border-foreground rounded-sm shadow-lg dark:shadow-none flex flex-col";

  const formElement = (
    <div className={`space-y-4 rounded-lg ${floating ? 'mb-0' : 'mb-4'}`}>
      <div
        className={formClasses}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {formContent}
      </div>
    </div>
  );

  if (floating) {
    return (
      <div className="sticky bottom-0 z-30 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent">
        {formElement}
      </div>
    );
  }

  return formElement;
});

DiscoveryForm.displayName = 'DiscoveryForm';

export default DiscoveryForm;

"use client";

import { useState, useRef, useEffect } from "react";
import { useAPI } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";

export interface IntentChange {
  type: 'location' | 'timeframe' | 'stage' | 'role' | 'refinement';
  value: string;
  original: string;
  timestamp: Date;
  newIntent: string;
}

interface FloatingChatInputProps {
  intentId?: string;
  currentIntent?: string;
  onIntentUpdate?: (updatedIntent: string, change?: IntentChange) => void;
  onFeedback?: (feedback: string) => void;
}

export default function FloatingChatInput({
  intentId,
  currentIntent = '',
  onIntentUpdate,
  onFeedback
}: FloatingChatInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ text: string; action: string }>>([]);
  const [intentHistory, setIntentHistory] = useState<IntentChange[]>([]);
  const [currentIntentText, setCurrentIntentText] = useState(currentIntent);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { intentsService } = useAPI();
  const { error } = useNotifications();

  // Update current intent text when prop changes
  useEffect(() => {
    setCurrentIntentText(currentIntent);
  }, [currentIntent]);

  // Generate contextual suggestions based on current intent
  useEffect(() => {
    const generateSuggestions = () => {
      const intentLower = currentIntentText.toLowerCase();
      const newSuggestions: Array<{ text: string; action: string }> = [];

      // Check if location is mentioned
      const hasLocation = /\b(san francisco|new york|nyc|austin|seattle|palo alto|sf|ny|ca|tx|wa|based in|located in)\b/i.test(currentIntentText);
      if (!hasLocation) {
        newSuggestions.push({
          text: 'Add location (e.g., NYC only)',
          action: 'add-location'
        });
      }

      // Check if time frame is mentioned
      const hasTimeFrame = /\b(recent|new|early|late|2024|2023|last \d+ years?|founded in)\b/i.test(currentIntentText);
      if (!hasTimeFrame) {
        newSuggestions.push({
          text: 'Specify time frame (e.g., founded in last 2 years)',
          action: 'add-timeframe'
        });
      }

      // Check if company stage is mentioned
      const hasStage = /\b(seed|series [a-z]|early-stage|late-stage|pre-seed|growth)\b/i.test(currentIntentText);
      if (!hasStage) {
        newSuggestions.push({
          text: 'Add company stage',
          action: 'add-stage'
        });
      }

      // Check if specific roles are mentioned
      const hasSpecificRoles = /\b(cto|ceo|founder|co-founder|executive|vp|director)\b/i.test(intentLower);
      if (!hasSpecificRoles && /\bfounders?\s*&?\s*execs?\b/i.test(intentLower)) {
        newSuggestions.push({
          text: 'Specify roles (e.g., CTOs only)',
          action: 'add-roles'
        });
      }

      setSuggestions(newSuggestions);
    };

    generateSuggestions();
  }, [currentIntentText]);

  // Show inline confirmation
  const showConfirmation = (message: string) => {
    setConfirmationMessage(message);
    setTimeout(() => {
      setConfirmationMessage(null);
    }, 3000);
  };

  // Parse feedback to detect intent modifications
  const parseFeedback = (text: string): IntentChange[] => {
    const lowerText = text.toLowerCase();
    const changes: IntentChange[] = [];

    // Location filters
    if (lowerText.includes('nyc') || lowerText.includes('new york')) {
      changes.push({
        type: 'location',
        value: 'NYC',
        original: currentIntentText,
        timestamp: new Date(),
        newIntent: ''
      });
    } else if (lowerText.includes('sf') || lowerText.includes('san francisco')) {
      changes.push({
        type: 'location',
        value: 'San Francisco',
        original: currentIntentText,
        timestamp: new Date(),
        newIntent: ''
      });
    } else if (lowerText.includes('location') || lowerText.includes('based')) {
      const locationMatch = text.match(/(?:in|at|based in|based at)\s+([A-Za-z\s]+)/i);
      if (locationMatch) {
        changes.push({
          type: 'location',
          value: locationMatch[1].trim(),
          original: currentIntentText,
          timestamp: new Date(),
          newIntent: ''
        });
      }
    }

    // Time frame filters
    if (lowerText.includes('last') && lowerText.match(/\d+\s*(year|month)/)) {
      const timeMatch = text.match(/last\s+(\d+)\s*(year|month)s?/i);
      if (timeMatch) {
        changes.push({
          type: 'timeframe',
          value: `founded in last ${timeMatch[1]} ${timeMatch[2]}s`,
          original: currentIntentText,
          timestamp: new Date(),
          newIntent: ''
        });
      }
    } else if (lowerText.includes('recent') || lowerText.includes('new')) {
      changes.push({
        type: 'timeframe',
        value: 'recent',
        original: currentIntentText,
        timestamp: new Date(),
        newIntent: ''
      });
    }

    // Company stage
    if (lowerText.includes('seed') || lowerText.includes('series') || lowerText.includes('stage')) {
      const stageMatch = text.match(/(seed|series [a-z]|early-stage|late-stage|pre-seed)/i);
      if (stageMatch) {
        changes.push({
          type: 'stage',
          value: stageMatch[1],
          original: currentIntentText,
          timestamp: new Date(),
          newIntent: ''
        });
      }
    }

    // Roles
    if (lowerText.includes('cto') || lowerText.includes('ceo') || lowerText.includes('founder')) {
      const roleMatch = text.match(/(CTO|CEO|founder|co-founder|executive|VP|director)s?/i);
      if (roleMatch) {
        changes.push({
          type: 'role',
          value: roleMatch[1],
          original: currentIntentText,
          timestamp: new Date(),
          newIntent: ''
        });
      }
    }

    // General refinement
    if (changes.length === 0 && text.length > 10) {
      changes.push({
        type: 'refinement',
        value: text,
        original: currentIntentText,
        timestamp: new Date(),
        newIntent: ''
      });
    }

    return changes;
  };

  // Apply intent change
  const applyIntentChange = (change: IntentChange): string => {
    let newIntent = currentIntentText;

    switch (change.type) {
      case 'location':
        if (!newIntent.includes(change.value)) {
          newIntent += ` (${change.value} only)`;
        }
        break;
      case 'timeframe':
        if (!newIntent.includes(change.value)) {
          newIntent += ` [${change.value}]`;
        }
        break;
      case 'stage':
        if (!newIntent.includes(change.value)) {
          newIntent += ` [${change.value}]`;
        }
        break;
      case 'role':
        if (!newIntent.includes(change.value)) {
          newIntent = newIntent.replace(/founders?\s*&?\s*execs?/i, `${change.value}s & execs`);
        }
        break;
      case 'refinement':
        if (change.value.length < 50) {
          newIntent += ` [${change.value}]`;
        }
        break;
    }

    return newIntent;
  };

  // Handle suggestion click
  const handleSuggestionClick = (action: string) => {
    let inputText = '';
    
    switch (action) {
      case 'add-location':
        inputText = 'Add location: ';
        break;
      case 'add-timeframe':
        inputText = 'Add time frame: ';
        break;
      case 'add-stage':
        inputText = 'Add company stage: ';
        break;
      case 'add-roles':
        inputText = 'Specify roles: ';
        break;
    }
    
    if (inputText) {
      setInputValue(inputText);
      inputRef.current?.focus();
    }
  };

  // Send feedback
  const sendFeedback = async () => {
    const text = inputValue.trim();
    if (!text) return;

    try {
      // Parse feedback and check if it's intent-related
      const changes = parseFeedback(text);
      const isIntentRelated = changes.length > 0 && changes[0].type !== 'refinement';

      if (isIntentRelated && intentId) {
        // Update intent
        const change = changes[0];
        const newIntent = applyIntentChange(change);
        
        // Update intent via API
        await intentsService.updateIntent(intentId, newIntent);
        
        // Update local state
        const updatedChange: IntentChange = {
          ...change,
          newIntent
        };
        setIntentHistory(prev => [...prev, updatedChange]);
        setCurrentIntentText(newIntent);
        
        // Show confirmation
        showConfirmation('Intent updated');
        
        // Callback with change info
        if (onIntentUpdate) {
          onIntentUpdate(newIntent, updatedChange);
        }
      } else {
        // Send as general feedback
        if (onFeedback) {
          onFeedback(text);
        }
        showConfirmation('Thanks for your feedback');
      }

      // Clear input
      setInputValue('');
    } catch (err) {
      console.error('Failed to send feedback:', err);
      error(err instanceof Error ? err.message : 'Failed to send feedback');
    }
  };

  // Format time for changelog
  const formatTime = (date: Date): string => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  // Get change text for changelog
  const getChangeText = (change: IntentChange): string => {
    switch (change.type) {
      case 'location':
        return `Added location: ${change.value}`;
      case 'timeframe':
        return `Added time frame: ${change.value}`;
      case 'stage':
        return `Added company stage: ${change.value}`;
      case 'role':
        return `Refined roles: ${change.value}`;
      case 'refinement':
        return `Refined intent: ${change.value.substring(0, 40)}${change.value.length > 40 ? '...' : ''}`;
      default:
        return 'Intent updated';
    }
  };

  // Undo change
  const undoChange = (index: number) => {
    if (index < 0 || index >= intentHistory.length) return;
    
    const change = intentHistory[index];
    
    // Restore previous intent
    if (index === 0) {
      setCurrentIntentText(change.original);
    } else {
      setCurrentIntentText(intentHistory[index - 1].newIntent);
    }
    
    // Remove change from history
    setIntentHistory(prev => prev.filter((_, i) => i !== index));
    
    // Update intent via API if we have intentId
    if (intentId) {
      const restoredIntent = index === 0 ? change.original : intentHistory[index - 1].newIntent;
      intentsService.updateIntent(intentId, restoredIntent).then(() => {
        if (onIntentUpdate) {
          onIntentUpdate(restoredIntent);
        }
      }).catch(err => {
        error('Failed to undo change');
        console.error(err);
      });
    }
    
    showConfirmation('Change undone');
  };

  return (
    <div className="fixed bottom-3 left-1/2 transform -translate-x-1/2 z-[10000] w-full max-w-3xl px-4 md:px-16">
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-1.5 transition-all max-w-full">
        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {suggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(suggestion.action)}
                className="inline-block px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs cursor-pointer border-none font-sans transition-all hover:bg-gray-200 hover:text-gray-700"
              >
                {suggestion.text}
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendFeedback();
              }
            }}
            placeholder="Ask a follow-up question..."
            className="flex-1 py-2 border-none text-sm font-sans bg-transparent text-gray-900 outline-none placeholder:text-gray-400"
          />
          <button
            onClick={() => {
              // Voice input placeholder
              console.log('Voice input clicked');
            }}
            className="text-gray-600 cursor-pointer p-1.5 flex items-center justify-center transition-colors flex-shrink-0 hover:text-gray-700"
            title="Voice input"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
          <button
            onClick={sendFeedback}
            disabled={!inputValue.trim()}
            className="bg-gray-900 border-none cursor-pointer text-white p-2 rounded-md flex items-center justify-center transition-all flex-shrink-0 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-gray-400"
            title="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Inline confirmation */}
      {confirmationMessage && (
        <div className="mt-2 text-center">
          <span className="inline-block px-2 py-1 bg-green-100 text-green-800 rounded text-xs animate-fade-in-out">
            {confirmationMessage}
          </span>
        </div>
      )}

    </div>
  );
}


'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { Focus, Archive } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useIntents } from '@/contexts/APIContext';
import { useDiscoveryFilter } from '@/contexts/DiscoveryFilterContext';
import { useNotifications } from '@/contexts/NotificationContext';

interface SynthesisMarkdownProps {
  content: string;
  className?: string;
  onArchive?: () => void;
  popoverControlRef?: React.MutableRefObject<{ close: () => void } | null>;
}

export default function SynthesisMarkdown({ content, className = '', onArchive, popoverControlRef }: SynthesisMarkdownProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  const [currentLink, setCurrentLink] = useState<{ href: string; text: string; intentId?: string } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const intentsService = useIntents();
  const { setDiscoveryIntents } = useDiscoveryFilter();
  const { success, error } = useNotifications();

  const closePopover = () => setPopoverOpen(false);

  // Register/unregister close function when popover opens/closes
  useEffect(() => {
    if (popoverOpen && popoverControlRef) {
      popoverControlRef.current = { close: closePopover };
    }
  }, [popoverOpen, popoverControlRef]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't close if clicking on a link (let handleLinkClick manage it)
      const target = event.target as HTMLElement;
      if (target.tagName === 'A' && target.closest('.synthesis-markdown-content')) {
        return;
      }
      
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        closePopover();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePopover();
      }
    };

    const handleScroll = () => {
      closePopover();
    };

    if (popoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      window.addEventListener('scroll', handleScroll, true); // Use capture phase to catch all scrolls
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
        window.removeEventListener('scroll', handleScroll, true);
      };
    }
  }, [popoverOpen]);

  const handleLinkClick = (event: React.MouseEvent<HTMLAnchorElement>, href: string, text: string) => {
    event.preventDefault();
    event.stopPropagation();

    // Close any existing popover first
    if (popoverControlRef?.current) {
      popoverControlRef.current.close();
    }

    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const popoverWidth = 90;
    
    // Use click position for horizontal alignment, keep within viewport
    let x = event.clientX;
    if (x + popoverWidth > window.innerWidth) {
      x = window.innerWidth - popoverWidth - 10;
    }
    
    // Calculate which line was clicked and align below that line
    const clickY = event.clientY;
    const element = event.target as HTMLElement;
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 20;
    const relativeY = clickY - rect.top;
    const lineIndex = Math.floor(relativeY / lineHeight);
    const y = rect.top + (lineIndex + 1) * lineHeight + 4;

    // Extract intent ID from URL (e.g., /intents/123 or https://index.network/intents/123)
    const intentIdMatch = href.match(/\/intents\/([a-zA-Z0-9-]+)/);
    const intentId = intentIdMatch ? intentIdMatch[1] : undefined;

    // Always update position and link, then ensure popover is open
    setCurrentLink({ href, text, intentId });
    setPopoverPosition({ x, y });
    setPopoverOpen(true);
  };

  const handleFocus = async () => {
    if (currentLink?.intentId) {
      try {
        // Fetch the intent details
        const intent = await intentsService.getIntent(currentLink.intentId);
        if (intent) {
          // Set the intent as a discovery filter, converting null to undefined for summary
          setDiscoveryIntents([{
            id: intent.id,
            payload: intent.payload,
            summary: intent.summary || undefined,
            createdAt: intent.createdAt
          }]);
          // Navigate to inbox page
          router.push('/inbox');
          success('Filtering by this intent');
        }
      } catch (err) {
        console.error('Failed to fetch intent:', err);
        error('Failed to load intent');
      }
    }
    closePopover();
  };

  const handleArchive = async () => {
    if (currentLink?.intentId) {
      try {
        await intentsService.archiveIntent(currentLink.intentId);
        success('Intent archived');
        closePopover();
        // Call the onArchive callback to refetch data
        if (onArchive) {
          onArchive();
        }
      } catch (err) {
        console.error('Failed to archive intent:', err);
        error('Failed to archive intent');
      }
    }
  };

  return (
    <>
      <div className={`${className} synthesis-markdown-content`}>
        <ReactMarkdown
          components={{
            a: ({ href, children, ...props }) => (
              <a
                href={href}
                onClick={(e) => handleLinkClick(e, href || '', String(children))}
                className="text-[#007EFF] font-medium py-0.5 px-0.5 -mx-0.5 rounded-md hover:opacity-80 cursor-pointer bg-[#edf5ff]"
                {...props}
              >
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>

      {popoverOpen && typeof window !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[200] bg-white flex gap-1"
          style={{
            top: popoverPosition.y,
            left: popoverPosition.x,
          }}
        >
          <button
            onClick={handleFocus}
            className="flex items-center justify-center w-9 h-9 border border-b-2 rounded-xs border-black hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <Focus strokeWidth={1.5} className="w-6 h-6 text-gray-900" />
          </button>
          <button
            onClick={handleArchive}
            className="flex items-center justify-center w-9 h-9 border border-b-2 rounded-xs border-black hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <Archive strokeWidth={1.5} className="w-6 h-6 text-red-500" />
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

    
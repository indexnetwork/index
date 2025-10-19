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
}

export default function SynthesisMarkdown({ content, className = '', onArchive }: SynthesisMarkdownProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  const [currentLink, setCurrentLink] = useState<{ href: string; text: string; intentId?: string } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const intentsService = useIntents();
  const { setDiscoveryIntents } = useDiscoveryFilter();
  const { success, error } = useNotifications();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't close if clicking on a link (let handleLinkClick manage it)
      const target = event.target as HTMLElement;
      if (target.tagName === 'A' && target.closest('.synthesis-markdown-content')) {
        return;
      }
      
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setPopoverOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPopoverOpen(false);
      }
    };

    const handleScroll = () => {
      setPopoverOpen(false);
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

    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const popoverWidth = 200;
    const x = Math.min(rect.left, window.innerWidth - popoverWidth - 10);
    const y = rect.bottom + 4;

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
    setPopoverOpen(false);
  };

  const handleArchive = async () => {
    if (currentLink?.intentId) {
      try {
        await intentsService.archiveIntent(currentLink.intentId);
        success('Intent archived');
        setPopoverOpen(false);
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
                className="text-[#ec6767] font-bold underline hover:opacity-80 cursor-pointer"
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
          className="fixed z-[200] bg-white border border-b-2 border-gray-800 shadow-lg flex gap-2"
          style={{
            top: popoverPosition.y,
            left: popoverPosition.x,
          }}
        >
          <button
            onClick={handleFocus}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors cursor-pointer"
          >
            <Focus className="w-4 h-4 text-gray-600" />
            <span className="text-gray-900">Focus</span>
          </button>
          <button
            onClick={handleArchive}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-red-50 transition-colors cursor-pointer"
          >
            <Archive className="w-4 h-4 text-red-600" />
            <span className="text-red-600">Archive</span>
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

    
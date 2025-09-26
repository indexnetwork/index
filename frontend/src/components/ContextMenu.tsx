'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: React.ReactNode;
  className?: string;
  trigger?: 'click' | 'contextmenu';
  onOpenChange?: (isOpen: boolean) => void;
}

export default function ContextMenu({ items, children, className = '', trigger = 'contextmenu', onOpenChange }: ContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Notify parent when open state changes
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen]);

  const handleMenuTrigger = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Position context menu near the right edge of the trigger element
      const menuWidth = 180; // min-w-[180px]
      const x = Math.min(rect.right - 10, window.innerWidth - menuWidth - 10);
      const y = rect.bottom + 4; // Position below the trigger
      setPosition({ x, y });
    } else {
      setPosition({ x: event.clientX, y: event.clientY });
    }
    
    setIsOpen(!isOpen);
  };

  const handleItemClick = (item: ContextMenuItem) => {
    if (!item.disabled) {
      item.onClick();
      setIsOpen(false);
    }
  };

  const triggerProps = trigger === 'click' 
    ? { onClick: handleMenuTrigger }
    : { onContextMenu: handleMenuTrigger };

  return (
    <>
      <div
        ref={triggerRef}
        {...triggerProps}
        className={className}
      >
        {children}
      </div>
      
      {isOpen && typeof window !== 'undefined' && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-[200] bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px]"
          style={{
            top: position.y,
            left: position.x,
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => handleItemClick(item)}
              disabled={item.disabled}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors ${
                item.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              {item.icon && <span className="text-gray-500">{item.icon}</span>}
              <span className="text-gray-900">{item.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

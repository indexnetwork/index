'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  className?: string;
  trigger?: 'click' | 'contextmenu';
  onOpenChange?: (isOpen: boolean) => void;
  buttonClassName?: string;
}

export default function ContextMenu({ items, className = '', trigger = 'contextmenu', onOpenChange, buttonClassName = '' }: ContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  const handleItemClick = (event: React.MouseEvent, item: ContextMenuItem) => {
    event.preventDefault();
    event.stopPropagation();
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
      <button
        ref={triggerRef}
        {...triggerProps}
        className={`p-1 cursor-pointer rounded opacity-0 group-hover:opacity-100 transition-opacity ${
          isOpen
            ? 'bg-gray-200 opacity-100' 
            : 'hover:bg-gray-200'
        } ${buttonClassName}`}
      >
        <MoreVertical className="w-4 h-4 text-black" />
      </button>
      
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
              onClick={(event) => handleItemClick(event, item)}
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

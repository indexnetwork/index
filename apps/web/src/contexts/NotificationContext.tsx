import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { Check, X, AlertCircle, Info } from 'lucide-react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'intent_broadcast';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  avatarUrl?: string;
  duration?: number; // in milliseconds, default 4000
  onClick?: () => void;
  onAction?: () => void | Promise<void>;
}

interface NotificationContextType {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id'>) => void;
  removeNotification: (id: string) => void;
  success: (title: string, message?: string, duration?: number) => void;
  error: (title: string, message?: string, duration?: number) => void;
  warning: (title: string, message?: string, duration?: number) => void;
  info: (title: string, message?: string, duration?: number) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(notification => notification.id !== id));
  }, []);

  const addNotification = useCallback((notification: Omit<Notification, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 11);
    const newNotification = { ...notification, id };

    setNotifications(prev => {
      // Limit to maximum 3 notifications
      const updatedNotifications = [...prev, newNotification];
      if (updatedNotifications.length > 3) {
        // Remove oldest notifications to maintain max of 3
        return updatedNotifications.slice(-3);
      }
      return updatedNotifications;
    });

    // Actionable intent toasts own their timer so async Undo can pause it.
    if (notification.type !== 'intent_broadcast' || !notification.onAction) {
      const duration = notification.duration || 4000;
      setTimeout(() => {
        removeNotification(id);
      }, duration);
    }
  }, [removeNotification]);

  // Convenience methods for different types
  const success = useCallback((title: string, message?: string, duration?: number) => {
    addNotification({ type: 'success', title, message, duration });
  }, [addNotification]);

  const error = useCallback((title: string, message?: string, duration?: number) => {
    addNotification({ type: 'error', title, message, duration });
  }, [addNotification]);

  const warning = useCallback((title: string, message?: string, duration?: number) => {
    addNotification({ type: 'warning', title, message, duration });
  }, [addNotification]);

  const info = useCallback((title: string, message?: string, duration?: number) => {
    addNotification({ type: 'info', title, message, duration });
  }, [addNotification]);

  return (
    <NotificationContext.Provider value={{
      notifications,
      addNotification,
      removeNotification,
      success,
      error,
      warning,
      info
    }}>
      {children}
      <NotificationToasts
        notifications={notifications}
        onRemove={removeNotification}
      />
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}

// Toast component that renders all notifications
function NotificationToasts({
  notifications,
  onRemove
}: {
  notifications: Notification[];
  onRemove: (id: string) => void;
}) {
  const getIcon = (type: NotificationType) => {
    switch (type) {
      case 'success':
        return <Check className="h-4 w-4 text-green-600" />;
      case 'error':
        return <X className="h-4 w-4 text-red-600" />;
      case 'warning':
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case 'info':
        return <Info className="h-4 w-4 text-blue-600" />;
    }
  };

  const getIconBackground = (type: NotificationType) => {
    switch (type) {
      case 'success':
        return 'bg-green-100';
      case 'error':
        return 'bg-red-100';
      case 'warning':
        return 'bg-yellow-100';
      case 'info':
        return 'bg-blue-100';
    }
  };

  return (
    <div className="fixed top-[4.5rem] right-4 z-50 flex flex-col gap-2 items-end">
      {notifications.map((notification, index) => {
        if (notification.type === 'intent_broadcast') {
          return (
            <IntentBroadcastToast
              key={notification.id}
              notification={notification}
              onRemove={onRemove}
              index={index}
            />
          );
        }

        return (
          <div
            key={notification.id}
            role={notification.onClick ? 'button' : undefined}
            tabIndex={notification.onClick ? 0 : undefined}
            onClick={notification.onClick}
            onKeyDown={notification.onClick ? (e) => e.key === 'Enter' && notification.onClick?.() : undefined}
            className={`flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg shadow-lg animate-in slide-in-from-right-2 min-w-80 max-w-[360px] w-full text-left ${notification.onClick ? 'cursor-pointer hover:bg-gray-50 transition-colors' : ''}`}
            style={{
              animationDelay: `${index * 100}ms`,
              animationFillMode: 'both',
            }}
          >
            {notification.avatarUrl ? (
              <img
                src={notification.avatarUrl}
                alt={notification.title}
                width={32}
                height={32}
                loading="lazy"
                className="flex-shrink-0 w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${getIconBackground(notification.type)}`}>
                {getIcon(notification.type)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">{notification.title}</p>
              {notification.message ? (
                <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{notification.message}</p>
              ) : null}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(notification.id);
              }}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-0.5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function IntentBroadcastToast({
  notification,
  onRemove,
  index,
}: {
  notification: Notification;
  onRemove: (id: string) => void;
  index: number;
}) {
  const [isUndoing, setIsUndoing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (isUndoing || actionError) return;
    const timeout = setTimeout(
      () => onRemove(notification.id),
      notification.duration || 4000,
    );
    return () => clearTimeout(timeout);
  }, [actionError, isUndoing, notification.duration, notification.id, onRemove]);

  const handleUndo = async () => {
    if (!notification.onAction || isUndoing) return;
    setIsUndoing(true);
    setActionError(null);
    try {
      await notification.onAction();
      onRemove(notification.id);
    } catch (error) {
      setActionError(error instanceof Error && error.message
        ? `Undo failed: ${error.message}`
        : "Undo failed. Please try again.");
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <div
      className="rounded-lg bg-white border border-gray-200 px-4 py-3 shadow-lg animate-in slide-in-from-right-2 min-w-80 max-w-[360px] w-full"
      style={{
        animationDelay: `${index * 100}ms`,
        animationFillMode: 'both',
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-green-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            {notification.title || "Broadcasting Signal"}
          </div>
          <p className="text-[13px] text-[#3D3D3D] leading-relaxed mt-0.5 line-clamp-2">
            {notification.message || notification.title}
          </p>
          {actionError && (
            <p role="alert" className="mt-1 text-xs text-red-600">{actionError}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {notification.onAction && (
            <button
              type="button"
              onClick={handleUndo}
              disabled={isUndoing}
              className="text-xs text-gray-400 hover:text-gray-500 disabled:opacity-60"
            >
              {isUndoing ? "Undoing…" : "Undo"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

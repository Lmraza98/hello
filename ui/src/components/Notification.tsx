import { useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Loader2, X } from 'lucide-react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
}

interface NotificationProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

export function NotificationToast({ notification, onDismiss }: NotificationProps) {
  useEffect(() => {
    if (notification.type !== 'loading' && notification.duration !== 0) {
      const timer = setTimeout(() => {
        onDismiss(notification.id);
      }, notification.duration || 5000);
      return () => clearTimeout(timer);
    }
  }, [notification, onDismiss]);

  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: AlertCircle,
    loading: Loader2,
  };

  const colors = {
    success: 'bg-success/10 border-success/30 text-success',
    error: 'bg-error/10 border-error/30 text-error',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    info: 'bg-accent/10 border-accent/30 text-accent',
    loading: 'bg-accent/10 border-accent/30 text-accent',
  };

  const Icon = icons[notification.type];

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border min-w-[320px] max-w-md shadow-lg ${colors[notification.type]}`}
    >
      <Icon
        className={`w-5 h-5 shrink-0 mt-0.5 ${
          notification.type === 'loading' ? 'animate-spin' : ''
        }`}
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{notification.title}</p>
        {notification.message && (
          <p className="text-xs mt-1 opacity-90">{notification.message}</p>
        )}
      </div>
      {notification.type !== 'loading' && (
        <button
          onClick={() => onDismiss(notification.id)}
          className="shrink-0 p-1 hover:bg-black/10 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}



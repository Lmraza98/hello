import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import type { Notification } from '../components/Notification';

interface NotificationContextType {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id'>) => string;
  removeNotification: (id: string) => void;
  updateNotification: (id: string, updates: Partial<Notification>) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { notifications, addNotification, removeNotification, updateNotification } = useNotifications();

  return (
    <NotificationContext.Provider value={{ notifications, addNotification, removeNotification, updateNotification }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationContext() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotificationContext must be used within NotificationProvider');
  }
  return context;
}


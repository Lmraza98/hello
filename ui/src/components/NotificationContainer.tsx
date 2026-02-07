import { useNotificationContext } from '../contexts/NotificationContext';
import { NotificationToast } from './Notification';

export function NotificationContainer() {
  const { notifications, removeNotification } = useNotificationContext();

  return (
    <div className="fixed top-12 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {notifications.map((notification) => (
        <div key={notification.id} className="pointer-events-auto">
          <NotificationToast
            notification={notification}
            onDismiss={removeNotification}
          />
        </div>
      ))}
    </div>
  );
}



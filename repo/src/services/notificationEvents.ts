export interface NotificationChangedDetail {
  userId: string;
}

const NOTIFICATION_CHANGED_EVENT = 'studioops:notification-changed';

export function emitNotificationChanged(userId: string): void {
  window.dispatchEvent(
    new CustomEvent<NotificationChangedDetail>(NOTIFICATION_CHANGED_EVENT, {
      detail: { userId }
    })
  );
}

export function subscribeNotificationChanged(
  callback: (detail: NotificationChangedDetail) => void
): () => void {
  const listener: EventListener = (event) => {
    const customEvent = event as CustomEvent<NotificationChangedDetail>;
    if (!customEvent.detail?.userId) {
      return;
    }

    callback(customEvent.detail);
  };

  window.addEventListener(NOTIFICATION_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener(NOTIFICATION_CHANGED_EVENT, listener);
  };
}

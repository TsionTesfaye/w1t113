export interface MessageChangedDetail {
  userId: string;
}

const MESSAGE_CHANGED_EVENT = 'studioops:message-changed';

export function emitMessageChanged(userId: string): void {
  window.dispatchEvent(
    new CustomEvent<MessageChangedDetail>(MESSAGE_CHANGED_EVENT, {
      detail: { userId }
    })
  );
}

export function subscribeMessageChanged(
  callback: (detail: MessageChangedDetail) => void
): () => void {
  const listener: EventListener = (event) => {
    const customEvent = event as CustomEvent<MessageChangedDetail>;
    if (!customEvent.detail?.userId) {
      return;
    }

    callback(customEvent.detail);
  };

  window.addEventListener(MESSAGE_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener(MESSAGE_CHANGED_EVENT, listener);
  };
}

import {writable} from 'svelte/store';

type Notification = {
  id?: string;
  delay: number;
  onAcknowledge?: () => void;
  title: string;
  text: string;
  type: 'error' | 'success' | 'info' | 'warning';
};

type CurrentNotification = {
  current?: Notification;
};

const createStore = () => {
  const recorded: Record<string, boolean> = {};
  const pending: Notification[] = [];
  const data: CurrentNotification = {
    current: undefined,
  };

  let timeout: NodeJS.Timeout;

  const {subscribe, set} = writable<CurrentNotification>(data);

  function setCurrent(current: Notification | undefined) {
    data.current = current;
    set(data);
    if (current && current.delay) {
      if (current.onAcknowledge) {
        current.onAcknowledge(); // TODO delay?
      }
      timeout = setTimeout(acknowledge, current.delay * 1000);
    }
  }

  function acknowledge() {
    const current = data.current;
    if (current && !current.delay && current.onAcknowledge) {
      current.onAcknowledge();
    }
    const next = pending.shift();
    clearTimeout(timeout);
    setCurrent(next);
  }

  function queue(notification: Notification) {
    if (notification.id) {
      if (recorded[notification.id]) {
        return;
      }
      recorded[notification.id] = true;
    }
    if (pending.length > 0 || data.current) {
      pending.push(notification);
    } else {
      setCurrent(notification);
    }
  }

  return {
    subscribe,
    queue,
    acknowledge,
    clear: () => {
      pending.splice(0, pending.length);
      acknowledge();
    },
  };
};

export const notifications = createStore();

// USEFUL FOR DEBUGGING:
if (typeof window !== 'undefined') {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).notifications = notifications;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

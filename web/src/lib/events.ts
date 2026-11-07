import { API_ORIGIN } from './api';

type ServerEventHandlers = Record<string, (event: MessageEvent<string>) => void>;

interface Subscription {
  handlers: ServerEventHandlers;
  onError?: () => void;
}

// The API pushes live readings and alerts over one SSE endpoint. Every surface
// that wants them shares a single connection: browsers cap concurrent
// connections per origin, and a stream per page multiplies server work for the
// same frames.
let source: EventSource | null = null;
const boundTypes = new Set<string>();
const subscriptions = new Set<Subscription>();

function ensureSource(): EventSource {
  if (source) return source;
  const created = new EventSource(`${API_ORIGIN}/api/v1/events`, { withCredentials: true });
  created.onerror = () => {
    for (const subscription of subscriptions) subscription.onError?.();
  };
  source = created;
  return created;
}

function bindType(created: EventSource, type: string) {
  if (boundTypes.has(type)) return;
  boundTypes.add(type);
  created.addEventListener(type, (event) => {
    for (const subscription of subscriptions) {
      subscription.handlers[type]?.(event as MessageEvent<string>);
    }
  });
}

/**
 * Subscribe to named server events over the shared stream. The returned
 * function removes the subscriber; the connection closes with the last one.
 */
export function subscribeServerEvents(
  handlers: ServerEventHandlers,
  options: { onError?: () => void } = {},
): () => void {
  const subscription: Subscription = { handlers, onError: options.onError };
  const created = ensureSource();
  for (const type of Object.keys(handlers)) bindType(created, type);
  subscriptions.add(subscription);
  return () => {
    subscriptions.delete(subscription);
    if (subscriptions.size === 0) {
      created.close();
      if (source === created) source = null;
      boundTypes.clear();
    }
  };
}

import type { Response } from 'express';

interface Client {
  id: string;
  res: Response;
}

const clients = new Set<Client>();

export function addEventClient(res: Response): string {
  const id = crypto.randomUUID();
  clients.add({ id, res });
  return id;
}

export function removeEventClient(id: string): void {
  for (const client of clients) {
    if (client.id === id) clients.delete(client);
  }
}

export function emitEvent(type: string, payload: unknown): void {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(data);
    } catch {
      clients.delete(client);
    }
  }
}

export function clientCount(): number {
  return clients.size;
}

// SSE streams never end on their own, so close them before a graceful shutdown
// or they would hold the server open until the force-exit timer.
export function closeEventClients(): void {
  for (const client of clients) {
    try {
      client.res.end();
    } catch {
      // The stream is already closed.
    }
  }
  clients.clear();
}

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

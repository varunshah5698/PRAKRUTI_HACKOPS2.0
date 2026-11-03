import { one } from '../db/pool.js';

export async function nextPublicRef(prefix: 'R' | 'A' | 'I' | 'SIM', sequence: string): Promise<string> {
  const row = await one<{ value: string }>(`SELECT nextval('${sequence}')::text AS value`);
  return `EP-${prefix}-${new Date().getFullYear()}-${row?.value}`;
}

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { appConfig } from '../config/env.js';
import { badRequest } from '../middleware/errors.js';

const evidenceDir = path.join(appConfig.storageRoot, 'evidence');
const MAX_BYTES = 8 * 1024 * 1024;

const SIGNATURES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export function validateImage(buffer: Buffer, declaredMime: string): { mime: string; ext: string } {
  if (buffer.length === 0) throw badRequest('Uploaded file is empty.');
  if (buffer.length > MAX_BYTES) throw badRequest('Photograph must be 8 MB or smaller.');
  const match = SIGNATURES.find((s) => s.test(buffer));
  if (!match) throw badRequest('Only JPEG, PNG or WebP photographs are accepted.');
  if (declaredMime && declaredMime !== match.mime) {
    throw badRequest('Declared file type does not match the file signature.');
  }
  return { mime: match.mime, ext: match.ext };
}

export async function saveEvidence(
  buffer: Buffer,
  declaredMime: string,
  originalName: string | undefined,
): Promise<{ key: string; mime: string; size: number; sha256: string; originalName: string | null }> {
  const { mime, ext } = validateImage(buffer, declaredMime);
  await fs.mkdir(evidenceDir, { recursive: true });
  const key = `${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(evidenceDir, key);
  await fs.writeFile(filePath, buffer, { mode: 0o600 });
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const safeName = path.basename(originalName ?? 'evidence').replace(/["\r\n]/g, '').slice(0, 200);
  return { key, mime, size: buffer.length, sha256, originalName: originalName ? safeName : null };
}

export async function readEvidence(key: string): Promise<Buffer> {
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/i.test(key)) throw badRequest('Invalid evidence key.');
  const filePath = path.join(evidenceDir, key);
  if (!filePath.startsWith(evidenceDir)) throw badRequest('Invalid evidence path.');
  return fs.readFile(filePath);
}

export const evidenceLimits = { maxBytes: MAX_BYTES, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] };

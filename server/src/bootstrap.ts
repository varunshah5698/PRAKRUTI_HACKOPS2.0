import crypto from 'node:crypto';

// Render does not provide a stable secret unless one is configured. Generate a
// temporary one so the service can boot; sessions reset whenever it restarts.
if (process.env.RENDER === 'true' && !process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
  console.warn('[config] JWT_SECRET is not set. Using an ephemeral secret; sessions will reset on restart.');
}

await import('./db/setup.js');
await import('./index.js');

import crypto from 'node:crypto';

// Render does not provide a stable secret unless one is configured. Generate a
// temporary one so the service can boot; sessions reset whenever it restarts.
if (process.env.RENDER === 'true' && !process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
  console.warn('[config] JWT_SECRET is not set. Using an ephemeral secret; sessions will reset on restart.');
}

const { main: setupDatabase } = await import('./db/setup.js');

// Render's Postgres can still be provisioning when the first boot happens.
for (let attempt = 1; ; attempt++) {
  try {
    await setupDatabase();
    break;
  } catch (error) {
    if (attempt >= 20) throw error;
    console.warn(`Database not ready (attempt ${attempt}/20): ${(error as Error).message}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

await import('./index.js');

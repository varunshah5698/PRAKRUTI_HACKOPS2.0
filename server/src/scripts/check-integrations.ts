import nodemailer from 'nodemailer';
import { env, riverConfig, visionConfig, emailConfigured } from '../config/env.js';
import { one, closePool } from '../db/pool.js';

async function checkDatabase() {
  try {
    await one('SELECT 1 AS ok');
    return 'CONNECTED';
  } catch (error) {
    return `FAILED: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

async function checkDataGovIn() {
  if (!env.DATA_GOV_IN_API_KEY || !env.DATA_GOV_IN_AIR_RESOURCE_ID) return 'NOT_CONFIGURED (DATA_GOV_IN_API_KEY / resource ID)';
  try {
    const url = new URL(`https://api.data.gov.in/resource/${env.DATA_GOV_IN_AIR_RESOURCE_ID}`);
    url.searchParams.set('api-key', env.DATA_GOV_IN_API_KEY);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('filters[city]', 'Mumbai');
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = await response.text();
    return `${response.status} ${body.slice(0, 180)}`;
  } catch (error) {
    return `FAILED: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

async function checkOpenAq() {
  if (!env.OPENAQ_API_KEY) return 'NOT_CONFIGURED (OPENAQ_API_KEY)';
  try {
    const url = new URL('https://api.openaq.org/v3/locations');
    url.searchParams.set('coordinates', '19.076,72.8777');
    url.searchParams.set('radius', '25000');
    url.searchParams.set('limit', '1');
    const response = await fetch(url, {
      headers: { 'X-API-Key': env.OPENAQ_API_KEY },
      signal: AbortSignal.timeout(20_000),
    });
    return `${response.status} ${(await response.text()).slice(0, 180)}`;
  } catch (error) {
    return `FAILED: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

async function checkRiver() {
  if (!riverConfig.configured) return 'NOT_CONFIGURED (RIVER_API_KEY)';
  try {
    const response = await fetch(`${riverConfig.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${riverConfig.apiKey}` },
      body: JSON.stringify({
        model: riverConfig.model,
        max_tokens: 20,
        messages: [{ role: 'user', content: 'Reply with the word READY only.' }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    return `${response.status} ${(await response.text()).slice(0, 220)}`;
  } catch (error) {
    return `FAILED: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

async function checkVision() {
  if (!visionConfig.configured) return 'NOT_CONFIGURED (VISION_BASE_URL / VISION_MODEL / VISION_API_KEY)';
  return `CONFIGURED (${visionConfig.model}); use a real citizen image in /report to verify the provider response format.`;
}

async function checkEmail() {
  if (!emailConfigured) return 'NOT_CONFIGURED (SMTP_HOST / SMTP_USER / SMTP_PASSWORD)';
  try {
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    });
    await transporter.verify();
    return `SMTP VERIFIED${env.DEMO_MODE ? `; demo recipient ${env.DEMO_EMAIL_RECIPIENT || 'NOT SET'}` : ''}`;
  } catch (error) {
    return `FAILED: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

async function checkMl() {
  if (!env.ML_SERVICE_URL) return 'NOT_CONFIGURED (ML_SERVICE_URL)';
  try {
    const response = await fetch(`${env.ML_SERVICE_URL.replace(/\/$/, '')}/health`, {
      headers: env.ML_SERVICE_API_KEY ? { Authorization: `Bearer ${env.ML_SERVICE_API_KEY}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    return `${response.status} ${(await response.text()).slice(0, 220)}`;
  } catch (error) {
    return `FAILED: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

async function main() {
  const checks: Array<[string, string]> = [
    ['Database', await checkDatabase()],
    ['data.gov.in CPCB resource', await checkDataGovIn()],
    ['OpenAQ', await checkOpenAq()],
    ['River AI', await checkRiver()],
    ['Vision AI', await checkVision()],
    ['Email', await checkEmail()],
    ['ML service', await checkMl()],
    ['Map style URL', env.MAP_STYLE_URL],
  ];
  for (const [name, result] of checks) console.log(`${name}: ${result}`);
  console.log('\nNo secrets are printed. Add credentials to .env.local and restart the API.');
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});

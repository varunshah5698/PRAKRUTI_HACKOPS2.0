import nodemailer from 'nodemailer';
import { env, riverConfig, visionConfig, emailConfigured } from '../config/env.js';
import { one, closePool } from '../db/pool.js';
import { analyzeEvidenceImage } from '../services/ai/analyst.js';

// 64x64 solid PNG: accepted by Groq, small enough not to trip the per-minute token cap.
const VISION_TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAQKADAAQAAAABAAAAQAAAAABGUUKwAAAAi0lEQVR4Ae3VgQ3AIAwEscDijA4Sa5y7Aa9zs+7MmfC3w2//TzeAAuILIBAPYBSggPgCCMQD8BNEAIH4AgjEA3AFEEAgvgAC8QBcAQQQiC+AQDwAVwABBOILIBAPwBVAAIH4AgjEA3AFEEAgvgAC8QBcAQQQiC+AQDwAVwABBOILIBAPwBVAAIH4Ag8zVQH+bUr8EgAAAABJRU5ErkJggg==',
  'base64',
);

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
    url.searchParams.set('limit', '5');
    url.searchParams.set('filters[city]', 'Mumbai');
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = (await response.json()) as {
      total?: number;
      records?: Array<{ station?: string; pollutant_id?: string; avg_value?: string }>;
    };
    return `${response.status} total=${body.total ?? 0} sample=${body.records?.length ?? 0}${body.records?.[0]?.station ? ` (${body.records[0].station} ${body.records[0].pollutant_id}=${body.records[0].avg_value})` : ''}`;
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
        max_tokens: 200,
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: 'Reply with the word READY only.' }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    return `${response.status} finalContent=${content ? content.slice(0, 80) : 'EMPTY (reasoning-only response)'}`;
  } catch (error) {
    return `FAILED: ${error instanceof Error ? error.message : 'unknown'}`;
  }
}

async function checkVision() {
  if (!visionConfig.configured) return 'NOT_CONFIGURED (no usable VISION_* or fallback credentials)';
  const result = await analyzeEvidenceImage(VISION_TEST_PNG, 'image/png');
  if (result.status === 'COMPLETED') return `CONNECTED (${result.provider})`;
  return `${result.status}: ${String(result.output.error ?? result.output.reason ?? 'unknown')}`;
}

async function checkEmail() {
  if (!emailConfigured) return 'NOT_CONFIGURED (SMTP_USER / SMTP_PASSWORD; SMTP_HOST for non-Gmail)';
  try {
    if (env.EMAIL_PROVIDER.toLowerCase() === 'brevo') {
      const { verifyBrevoSender } = await import('../services/brevo.js');
      const result = await verifyBrevoSender();
      return `BREVO HTTPS ${result.verified ? 'SENDER VERIFIED' : 'SENDER NOT VERIFIED'} (HTTP ${result.httpStatus ?? 'n/a'})${result.error ? ` — ${result.error}` : ''}`;
    }
    const gmail = env.EMAIL_PROVIDER === 'gmail' || env.SMTP_HOST.toLowerCase().endsWith('gmail.com');
    const transporter = nodemailer.createTransport(
      gmail
        ? { service: 'gmail', auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
        : {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE || env.SMTP_PORT === 465,
            auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
          },
    );
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

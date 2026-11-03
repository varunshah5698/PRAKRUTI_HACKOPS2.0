import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, query } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cardPath = path.resolve(here, '../../../ml/artifacts/model_card.json');

interface ModelCard {
  model_version?: string;
  trained_at?: string;
  metrics?: Record<string, unknown>;
  rows?: number;
  stations?: number;
  split?: string;
}

async function main() {
  let card: ModelCard;
  try {
    card = JSON.parse(await fs.readFile(cardPath, 'utf8')) as ModelCard;
  } catch {
    console.error(`No trained model card found at ${cardPath}. Run ml/train.py first. Models remain NOT_TRAINED.`);
    process.exit(1);
  }
  const trainedAt = card.trained_at ?? new Date().toISOString();
  const version = card.model_version ?? 'trained-v1';
  const note = `Registered from ml/artifacts/model_card.json. Metrics apply only to the registered training extract (${card.rows ?? '?'} rows, ${card.stations ?? '?'} stations).`;

  const updates: Array<{ name: string; version: string; metrics: unknown }> = [
    { name: 'lightgbm_pm25', version: 'v1-1h', metrics: card.metrics?.['pm25_1h'] ?? null },
    { name: 'lightgbm_pm25', version: 'v1-3h', metrics: card.metrics?.['pm25_3h'] ?? null },
    { name: 'lightgbm_pm25', version: 'v1-6h', metrics: card.metrics?.['pm25_6h'] ?? null },
    { name: 'lightgbm_quantile', version: 'v1', metrics: card.metrics?.['pm25_3h_quantile_80'] ?? null },
    { name: 'deterioration_classifier', version: 'v1', metrics: card.metrics?.['deterioration_classifier_3h'] ?? null },
  ];
  for (const model of updates) {
    await query(
      `UPDATE model_registry SET status='TRAINED', metrics=$3::jsonb, trained_at=$4, notes=$5
       WHERE name=$1 AND version=$2`,
      [model.name, model.version, JSON.stringify(model.metrics), trainedAt, `${note} Model version ${version}.`],
    );
  }
  await query(`UPDATE model_registry SET status='BASELINE', notes=$1 WHERE name='persistence_baseline' AND version='v1'`, [
    'Labelled persistence baseline. Not a trained ML model; not calibrated.',
  ]);
  const rows = await query<{ name: string; version: string; status: string }>(
    `SELECT name, version, status FROM model_registry ORDER BY name, version`,
  );
  console.log('Model registry updated:', rows);
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { closePool, one, query } from '../db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const csvPath = path.join(root, 'ml/data/mumbai_air_quality_archive.csv');
const metaPath = path.join(root, 'ml/data/mumbai_air_quality_archive.meta.json');
const days = Number(process.argv[2] ?? 45);
const cutoff = Date.now() - days * 86_400_000;

interface ArchiveStation {
  station_id: string;
  openaq_id: number;
  name: string;
  latitude: number;
  longitude: number;
  provider?: string;
  owner?: string;
}

const units: Record<string, string> = {
  pm25: 'µg/m³',
  pm10: 'µg/m³',
  no2: 'µg/m³',
  so2: 'µg/m³',
  o3: 'µg/m³',
  co: 'mg/m³',
};

async function main() {
  if (!fs.existsSync(csvPath) || !fs.existsSync(metaPath)) {
    throw new Error('OpenAQ archive CSV/meta not found in ml/data.');
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { stations: ArchiveStation[] };
  const stationIds = new Map<string, { id: string; localityId: string | null; lat: number; lng: number }>();
  for (const station of meta.stations) {
    const row = await one<{ id: string; locality_id: string | null }>(
      `INSERT INTO monitoring_stations
         (code, name, provider, station_type, location, operator, health_status, is_simulated, metadata)
       VALUES ($1,$2,'OpenAQ archive (CPCB/MPCB/BMC/IITM)','AIR_CAAQMS',
         ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,'DEGRADED',false,$6::jsonb)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, location=EXCLUDED.location, metadata=EXCLUDED.metadata
       RETURNING id, locality_id`,
      [
        station.station_id,
        station.name,
        station.longitude,
        station.latitude,
        station.owner ?? null,
        JSON.stringify({ openaqId: station.openaq_id, source: 'OpenAQ S3 archive', provider: station.provider, owner: station.owner }),
      ],
    );
    if (!row) continue;
    const locality = await one<{ id: string }>(
      `SELECT id FROM localities ORDER BY location <-> (SELECT location FROM monitoring_stations WHERE id=$1) LIMIT 1`,
      [row.id],
    );
    if (!row.locality_id && locality) {
      await query('UPDATE monitoring_stations SET locality_id=$2 WHERE id=$1', [row.id, locality.id]);
    }
    stationIds.set(station.station_id, {
      id: row.id,
      localityId: row.locality_id ?? locality?.id ?? null,
      lat: station.latitude,
      lng: station.longitude,
    });
  }

  const stream = readline.createInterface({ input: fs.createReadStream(csvPath), crlfDelay: Infinity });
  let header: string[] = [];
  let inserted = 0;
  let skipped = 0;
  let batch: Array<Record<string, string | number | boolean | null>> = [];
  const flush = async () => {
    if (batch.length === 0) return;
    await query(
      `INSERT INTO environmental_observations
         (station_id, locality_id, category, pollutant_code, value, unit, observed_at, retrieved_at,
          quality_state, is_simulated, source_id, source_record_id)
       SELECT * FROM UNNEST(
         $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::numeric[], $6::text[], $7::timestamptz[],
         $8::timestamptz[], $9::text[], $10::boolean[], $11::text[], $12::text[]
       )
       ON CONFLICT (station_id, pollutant_code, observed_at, source_id) DO NOTHING`,
      [
        batch.map((row) => row.station_id),
        batch.map((row) => row.locality_id),
        batch.map(() => 'air'),
        batch.map((row) => row.pollutant_code),
        batch.map((row) => row.value),
        batch.map((row) => row.unit),
        batch.map((row) => row.observed_at),
        batch.map(() => new Date().toISOString()),
        batch.map(() => 'VALID'),
        batch.map(() => false),
        batch.map(() => 'openaq'),
        batch.map((row) => row.source_record_id),
      ],
    );
    inserted += batch.length;
    batch = [];
  };

  for await (const line of stream) {
    if (!line.trim()) continue;
    const values = line.split(',');
    if (header.length === 0) {
      header = values;
      continue;
    }
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = values[index] ?? '';
    });
    const station = stationIds.get(record.station_id);
    const timestamp = new Date(record.timestamp).getTime();
    if (!station || !Number.isFinite(timestamp) || timestamp < cutoff) {
      skipped += 1;
      continue;
    }
    for (const pollutant of Object.keys(units)) {
      const raw = record[pollutant];
      if (raw === undefined || raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      batch.push({
        station_id: station.id,
        locality_id: station.localityId,
        pollutant_code: pollutant,
        value,
        unit: units[pollutant],
        observed_at: new Date(timestamp).toISOString(),
        source_record_id: `openaq-archive:${record.station_id}:${pollutant}:${record.timestamp}`,
      });
      if (batch.length >= 1000) await flush();
    }
  }
  await flush();
  await query(
    `UPDATE monitoring_stations s SET
       last_seen_at=latest.observed_at,
       health_status=CASE WHEN latest.observed_at > now() - interval '6 hours' THEN 'ONLINE' ELSE 'DEGRADED' END
     FROM (
       SELECT station_id, MAX(observed_at) AS observed_at
       FROM environmental_observations WHERE source_id='openaq' GROUP BY station_id
     ) latest
     WHERE s.id=latest.station_id`,
  );
  await query(
    `UPDATE data_sources SET status='CONNECTED', last_success_at=now(), last_attempt_at=now(),
       record_count=GREATEST(record_count,(SELECT COUNT(*) FROM environmental_observations WHERE source_id='openaq')),
       error_message=NULL, notes='OpenAQ live + historical archive (CPCB/MPCB/BMC/IITM operators); source is OpenAQ, not a direct CPCB feed.'
     WHERE id='openaq'`,
  );
  console.log({ inserted, skipped, stations: stationIds.size, days, cutoff: new Date(cutoff).toISOString() });
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});

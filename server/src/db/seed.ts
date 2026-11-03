import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { closePool, one, query } from './pool.js';
import { syncSourceCatalogue } from '../services/sources.js';
import { ingestOpenMeteoCams, ingestOpenMeteoWeather } from '../services/ingest.js';
import { evaluateAllStations, evaluateWasteLocalities } from '../services/risk.js';
import { createOrUpdateAlert, syncAlertsFromStationAssessments, syncAlertsFromWasteAssessments } from '../services/alerts.js';
import { isWithinMumbai } from '../services/geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO_PASSWORD = 'Demo@1234';

interface LocalitySeed {
  name: string;
  lat: number;
  lon: number;
  osm_type: string;
  osm_id: number;
  display_name: string;
  within_mumbai_bbox: boolean;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function diurnal(hour: number): number {
  if (hour <= 5) return 0.84;
  if (hour <= 9) return 1.24;
  if (hour <= 16) return 0.9;
  if (hour <= 21) return 1.32;
  return 1.02;
}

async function nextRef(prefix: string, sequence: string): Promise<string> {
  const row = await one<{ value: string }>(`SELECT nextval('${sequence}')::text AS value`);
  return `EP-${prefix}-${new Date().getFullYear()}-${row?.value}`;
}

async function seedLocalities(): Promise<Map<string, { id: string; lat: number; lng: number }>> {
  const raw = JSON.parse(await fs.readFile(path.join(here, '../../data/localities.json'), 'utf8')) as LocalitySeed[];
  const map = new Map<string, { id: string; lat: number; lng: number }>();
  for (const locality of raw) {
    if (!locality.within_mumbai_bbox || !isWithinMumbai(locality.lat, locality.lon)) {
      console.warn(`Skipping ${locality.name}: outside Mumbai boundary`);
      continue;
    }
    const row = await one<{ id: string }>(
      `INSERT INTO localities (name, slug, lat, lng, location, osm_type, osm_id, geocode_source, coordinate_kind)
       VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($4,$3),4326)::geography,$5,$6,
         'OpenStreetMap via Nominatim (one-time geocode)','reference_point')
       ON CONFLICT (name) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, location=EXCLUDED.location
       RETURNING id`,
      [locality.name, slugify(locality.name), locality.lat, locality.lon, locality.osm_type, locality.osm_id],
    );
    if (row) map.set(locality.name, { id: row.id, lat: locality.lat, lng: locality.lon });
  }
  console.log(`Localities: ${map.size}`);
  return map;
}

async function seedUsers(localities: Map<string, { id: string; lat: number; lng: number }>) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = [
    {
      name: 'Demo System Administrator',
      email: 'admin@enviropulse.local',
      role: 'SYSTEM_ADMIN',
      department: 'प्रकृति',
      designation: 'Platform administrator',
      jurisdiction: 'Mumbai',
      locality: null,
    },
    {
      name: 'Demo Authority Administrator',
      email: 'authority@enviropulse.local',
      role: 'AUTHORITY_ADMIN',
      department: 'Maharashtra Pollution Control Board (demo)',
      designation: 'Regional officer',
      jurisdiction: 'Mumbai',
      locality: 'Worli',
    },
    {
      name: 'Demo Environmental Analyst',
      email: 'analyst@enviropulse.local',
      role: 'ENVIRONMENTAL_ANALYST',
      department: 'प्रकृति analysis cell (demo)',
      designation: 'Environmental analyst',
      jurisdiction: 'Mumbai',
      locality: 'Powai',
    },
    {
      name: 'Demo Field Officer',
      email: 'officer@enviropulse.local',
      role: 'FIELD_OFFICER',
      department: 'Municipal environmental inspection (demo)',
      designation: 'Field officer',
      jurisdiction: 'Mumbai',
      locality: 'Chembur',
    },
    {
      name: 'Demo Citizen',
      email: 'citizen@enviropulse.local',
      role: 'PUBLIC',
      department: null,
      designation: null,
      jurisdiction: null,
      locality: 'Bandra',
    },
  ];
  const ids: Record<string, string> = {};
  for (const user of users) {
    const localityId = user.locality ? localities.get(user.locality)?.id ?? null : null;
    const row = await one<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role, account_status, department, designation, jurisdiction, locality_id, email_verified)
       VALUES ($1,$2,$3,$4::user_role,'ACTIVE',$5,$6,$7,$8,true)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash,
         role=EXCLUDED.role, account_status='ACTIVE', department=EXCLUDED.department,
         designation=EXCLUDED.designation, jurisdiction=EXCLUDED.jurisdiction, locality_id=EXCLUDED.locality_id
       RETURNING id`,
      [user.name, user.email, passwordHash, user.role, user.department, user.designation, user.jurisdiction, localityId],
    );
    if (row) ids[user.email] = row.id;
  }
  const citizenId = ids['citizen@enviropulse.local'];
  if (citizenId) {
    await query(
      `INSERT INTO user_preferences (user_id, alert_categories, notify_email, locality_id, radius_km, consent_at)
       VALUES ($1, ARRAY['air','water','waste','industrial'], true, $2, 25, now())
       ON CONFLICT (user_id) DO UPDATE SET notify_email=true, radius_km=25, consent_at=now()`,
      [citizenId, localities.get('Bandra')?.id ?? null],
    );
  }
  console.log(`Users: ${Object.keys(ids).length} demo accounts`);
  return ids;
}

async function seedStations(localities: Map<string, { id: string; lat: number; lng: number }>) {
  const air: Array<[string, string, number, number, number]> = [
    ['DEMO-AIR-01', 'Colaba', 34, 1, 0.0012],
    ['DEMO-AIR-02', 'Worli', 46, 2, 0.0016],
    ['DEMO-AIR-03', 'Bandra', 41, 1, 0.0014],
    ['DEMO-AIR-04', 'Andheri', 54, 6, 0.0018],
    ['DEMO-AIR-05', 'Powai', 39, 1, 0.0013],
    ['DEMO-AIR-06', 'Ghatkopar', 58, 5, 0.0017],
    ['DEMO-AIR-07', 'Chembur', 66, 10, 0.0019],
    ['DEMO-AIR-08', 'Bandra Kurla Complex', 52, 3, 0.0015],
    ['DEMO-AIR-09', 'Malad', 56, 3, 0.0018],
    ['DEMO-AIR-10', 'Borivali', 43, 1, 0.0014],
  ];
  const stations: Array<{
    id: string;
    code: string;
    type: string;
    base: number;
    trend: number;
    lat: number;
    lng: number;
    localityId: string | null;
    health: string;
  }> = [];
  for (const [code, localityName, base, trend, offset] of air) {
    const locality = localities.get(localityName);
    if (!locality) continue;
    const lat = locality.lat + offset;
    const lng = locality.lng - offset;
    const row = await one<{ id: string }>(
      `INSERT INTO monitoring_stations (code, name, provider, station_type, locality_id, location, operator,
         health_status, is_simulated, metadata)
       VALUES ($1,$2,'प्रकृति demo network (synthetic)','AIR_CAAQMS',$3,
         ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,'Demonstration only',$6,true,$7::jsonb)
       ON CONFLICT (code) DO UPDATE SET location=EXCLUDED.location, health_status=EXCLUDED.health_status,
         metadata=EXCLUDED.metadata, locality_id=EXCLUDED.locality_id
       RETURNING id`,
      [
        code,
        `${localityName} demo air monitor`,
        locality.id,
        lng,
        lat,
        code === 'DEMO-AIR-06' ? 'DEGRADED' : 'ONLINE',
        JSON.stringify({ label: 'SIMULATION DATA', notCpcb: true, height: 'not surveyed' }),
      ],
    );
    if (row) {
      stations.push({
        id: row.id,
        code,
        type: 'AIR_CAAQMS',
        base,
        trend,
        lat,
        lng,
        localityId: locality.id,
        health: code === 'DEMO-AIR-06' ? 'DEGRADED' : 'ONLINE',
      });
    }
  }

  const waterSites: Array<[string, string, string, number, number]> = [
    ['DEMO-WATER-01', 'Mithi River — Mahim demo sampling point', 'Mahim', 0.0015, -0.001],
    ['DEMO-WATER-02', 'Mahul Creek — Chembur demo sampling point', 'Chembur', -0.002, 0.003],
    ['DEMO-WATER-03', 'Versova Creek — Andheri demo sampling point', 'Andheri', 0.002, -0.003],
  ];
  for (const [code, name, localityName, dLat, dLng] of waterSites) {
    const locality = localities.get(localityName);
    if (!locality) continue;
    const lat = locality.lat + dLat;
    const lng = locality.lng + dLng;
    const row = await one<{ id: string }>(
      `INSERT INTO monitoring_stations (code, name, provider, station_type, locality_id, location, operator,
         health_status, is_simulated, metadata)
       VALUES ($1,$2,'प्रकृति demo network (synthetic)','WATER_SAMPLING',$3,
         ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,'Demonstration only','ONLINE',true,$6::jsonb)
       ON CONFLICT (code) DO UPDATE SET location=EXCLUDED.location, locality_id=EXCLUDED.locality_id
       RETURNING id`,
      [code, name, locality.id, lng, lat, JSON.stringify({ label: 'SIMULATION DATA', sampleType: 'grab sample' })],
    );
    if (row) {
      stations.push({
        id: row.id,
        code,
        type: 'WATER_SAMPLING',
        base: 0,
        trend: 0,
        lat,
        lng,
        localityId: locality.id,
        health: 'ONLINE',
      });
    }
  }

  const industrialSites: Array<[string, string, string, number, number]> = [
    ['DEMO-IND-01', 'Trombay industrial demo stack monitor', 'Trombay', 0.002, 0.0015],
    ['DEMO-IND-02', 'Chembur industrial demo stack monitor', 'Chembur', -0.0015, 0.0025],
  ];
  for (const [code, name, localityName, dLat, dLng] of industrialSites) {
    const locality = localities.get(localityName);
    if (!locality) continue;
    const lat = locality.lat + dLat;
    const lng = locality.lng + dLng;
    const row = await one<{ id: string }>(
      `INSERT INTO monitoring_stations (code, name, provider, station_type, locality_id, location, operator,
         health_status, is_simulated, metadata)
       VALUES ($1,$2,'प्रकृति demo network (synthetic)','INDUSTRIAL_STACK',$3,
         ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,'Demonstration only','ONLINE',true,$6::jsonb)
       ON CONFLICT (code) DO UPDATE SET location=EXCLUDED.location, locality_id=EXCLUDED.locality_id
       RETURNING id`,
      [
        code,
        name,
        locality.id,
        lng,
        lat,
        JSON.stringify({ label: 'SIMULATION DATA', note: 'No facility identity is asserted.' }),
      ],
    );
    if (row) {
      stations.push({
        id: row.id,
        code,
        type: 'INDUSTRIAL_STACK',
        base: 0,
        trend: 0,
        lat,
        lng,
        localityId: locality.id,
        health: 'ONLINE',
      });
    }
  }
  console.log(`Stations: ${stations.length} (all simulation-labelled)`);
  return stations;
}

async function seedObservations(stations: Awaited<ReturnType<typeof seedStations>>) {
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);
  let count = 0;
  for (const station of stations.filter((s) => s.type === 'AIR_CAAQMS')) {
    const random = mulberry32(Number(station.code.replace(/\D/g, '')) * 7919);
    for (let hoursAgo = 72; hoursAgo >= 0; hoursAgo -= 1) {
      const observedAt = new Date(hourStart.getTime() - hoursAgo * 3_600_000);
      const hour = Math.floor((((observedAt.getTime() / 3_600_000 + 5.5) % 24) + 24) % 24);
      const trend = hoursAgo <= 24 ? ((24 - hoursAgo) / 24) * station.trend : 0;
      const pm25 = Math.max(5, station.base * diurnal(hour) + trend + (random() - 0.5) * 8);
      const values: Array<[string, number, string]> = [
        ['pm25', pm25, 'µg/m³'],
        ['pm10', pm25 * (1.9 + random() * 0.35) + 8, 'µg/m³'],
        ['no2', 22 + station.base * 0.22 + (random() - 0.5) * 8, 'µg/m³'],
        ['so2', 7 + station.base * 0.1 + (random() - 0.5) * 3, 'µg/m³'],
        ['co', 0.35 + station.base * 0.009 + (random() - 0.5) * 0.12, 'mg/m³'],
        ['o3', (hour >= 11 && hour <= 17 ? 72 : 38) + (random() - 0.5) * 18, 'µg/m³'],
      ];
      for (const [code, value, unit] of values) {
        await query(
          `INSERT INTO environmental_observations
             (station_id, locality_id, category, pollutant_code, value, unit, observed_at, retrieved_at,
              quality_state, is_simulated, source_id, source_record_id, location)
           VALUES ($1,$2,'air',$3,$4,$5,$6,now(),$7,true,'demo-network',$8,
             ST_SetSRID(ST_MakePoint($9,$10),4326)::geography)
           ON CONFLICT (station_id, pollutant_code, observed_at, source_id) DO NOTHING`,
          [
            station.id,
            station.localityId,
            code,
            Number(value.toFixed(2)),
            unit,
            observedAt.toISOString(),
            station.code === 'DEMO-AIR-06' && hoursAgo < 2 ? 'SUSPECT' : 'VALID',
            `${station.code}:${code}:${observedAt.toISOString()}`,
            station.lng,
            station.lat,
          ],
        );
        count += 1;
      }
    }
    await query(`UPDATE monitoring_stations SET last_seen_at=$2 WHERE id=$1`, [station.id, hourStart.toISOString()]);
    await query(
      `INSERT INTO station_health (station_id, status, checked_at, latency_ms, message, data_quality_score)
       VALUES ($1,$2,now(),$3,$4,$5)`,
      [
        station.id,
        station.health,
        station.health === 'ONLINE' ? 120 : 900,
        station.health === 'ONLINE' ? 'Demo feed available' : 'Demo feed: degraded (simulated)',
        station.health === 'ONLINE' ? 92 : 61,
      ],
    );
  }

  const waterParams: Record<string, Array<[string, number, string]>> = {
    'DEMO-WATER-01': [
      ['ph', 7.05, 'pH'],
      ['do', 3.6, 'mg/L'],
      ['turbidity', 46, 'NTU'],
      ['conductivity', 780, 'µS/cm'],
    ],
    'DEMO-WATER-02': [
      ['ph', 6.2, 'pH'],
      ['do', 4.1, 'mg/L'],
      ['turbidity', 58, 'NTU'],
      ['conductivity', 910, 'µS/cm'],
    ],
    'DEMO-WATER-03': [
      ['ph', 7.4, 'pH'],
      ['do', 5.6, 'mg/L'],
      ['turbidity', 22, 'NTU'],
      ['conductivity', 520, 'µS/cm'],
    ],
  };
  for (const station of stations.filter((s) => s.type === 'WATER_SAMPLING')) {
    const random = mulberry32(Number(station.code.replace(/\D/g, '')) * 104729);
    for (let sample = 8; sample >= 0; sample -= 1) {
      const observedAt = new Date(hourStart.getTime() - sample * 6 * 3_600_000);
      for (const [code, baseValue, unit] of waterParams[station.code] ?? []) {
        const value = baseValue + (random() - 0.5) * (code === 'conductivity' ? 40 : 0.6);
        await query(
          `INSERT INTO environmental_observations
             (station_id, locality_id, category, pollutant_code, value, unit, observed_at, retrieved_at,
              quality_state, is_simulated, source_id, source_record_id, location)
           VALUES ($1,$2,'water',$3,$4,$5,$6,now(),'VALID',true,'demo-network',$7,
             ST_SetSRID(ST_MakePoint($8,$9),4326)::geography)
           ON CONFLICT (station_id, pollutant_code, observed_at, source_id) DO NOTHING`,
          [
            station.id,
            station.localityId,
            code,
            Number(value.toFixed(2)),
            unit,
            observedAt.toISOString(),
            `${station.code}:${code}:${observedAt.toISOString()}`,
            station.lng,
            station.lat,
          ],
        );
        count += 1;
      }
    }
    await query(`UPDATE monitoring_stations SET last_seen_at=$2 WHERE id=$1`, [station.id, hourStart.toISOString()]);
  }

  for (const station of stations.filter((s) => s.type === 'INDUSTRIAL_STACK')) {
    const random = mulberry32(Number(station.code.replace(/\D/g, '')) * 15485863);
    for (let hoursAgo = 48; hoursAgo >= 0; hoursAgo -= 4) {
      const observedAt = new Date(hourStart.getTime() - hoursAgo * 3_600_000);
      const elevated = station.code === 'DEMO-IND-01' && hoursAgo <= 8;
      const values: Array<[string, number, string]> = [
        ['stack_pm', (elevated ? 92 : 38) + (random() - 0.5) * 8, 'mg/Nm³'],
        ['stack_nox', (elevated ? 210 : 95) + (random() - 0.5) * 15, 'mg/Nm³'],
        ['stack_so2', (elevated ? 160 : 70) + (random() - 0.5) * 12, 'mg/Nm³'],
      ];
      for (const [code, value, unit] of values) {
        await query(
          `INSERT INTO environmental_observations
             (station_id, locality_id, category, pollutant_code, value, unit, observed_at, retrieved_at,
              quality_state, is_simulated, source_id, source_record_id, location)
           VALUES ($1,$2,'industrial',$3,$4,$5,$6,now(),'VALID',true,'demo-network',$7,
             ST_SetSRID(ST_MakePoint($8,$9),4326)::geography)
           ON CONFLICT (station_id, pollutant_code, observed_at, source_id) DO NOTHING`,
          [
            station.id,
            station.localityId,
            code,
            Number(value.toFixed(2)),
            unit,
            observedAt.toISOString(),
            `${station.code}:${code}:${observedAt.toISOString()}`,
            station.lng,
            station.lat,
          ],
        );
        count += 1;
      }
    }
    await query(`UPDATE monitoring_stations SET last_seen_at=$2 WHERE id=$1`, [station.id, hourStart.toISOString()]);
  }
  console.log(`Environmental observations: ${count} (all is_simulated=true)`);
  await query(
    `UPDATE data_sources SET record_count=(SELECT COUNT(*) FROM environmental_observations WHERE source_id='demo-network'),
       last_success_at=now(), last_attempt_at=now(), status='CONNECTED' WHERE id='demo-network'`,
  );
}

async function seedPollutants() {
  const pollutants: Array<[string, string, string, string, string]> = [
    ['pm25', 'PM2.5', 'µg/m³', 'air', '24h'],
    ['pm10', 'PM10', 'µg/m³', 'air', '24h'],
    ['no2', 'Nitrogen dioxide (NO2)', 'µg/m³', 'air', '24h'],
    ['so2', 'Sulphur dioxide (SO2)', 'µg/m³', 'air', '24h'],
    ['co', 'Carbon monoxide (CO)', 'mg/m³', 'air', '8h'],
    ['o3', 'Ozone (O3)', 'µg/m³', 'air', '8h'],
    ['ph', 'pH', 'pH', 'water', 'grab sample'],
    ['do', 'Dissolved oxygen', 'mg/L', 'water', 'grab sample'],
    ['turbidity', 'Turbidity', 'NTU', 'water', 'grab sample'],
    ['conductivity', 'Conductivity', 'µS/cm', 'water', 'grab sample'],
    ['stack_pm', 'Stack particulate matter (demo)', 'mg/Nm³', 'industrial', 'stack sample'],
    ['stack_nox', 'Stack nitrogen oxides (demo)', 'mg/Nm³', 'industrial', 'stack sample'],
    ['stack_so2', 'Stack sulphur dioxide (demo)', 'mg/Nm³', 'industrial', 'stack sample'],
  ];
  for (const [code, name, unit, category, averaging] of pollutants) {
    await query(
      `INSERT INTO pollutant_types (code, name, unit, category, averaging_period) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, unit=EXCLUDED.unit`,
      [code, name, unit, category, averaging],
    );
  }
}

async function seedModels() {
  const models: Array<[string, string, string, string, number | null, string, string]> = [
    ['persistence_baseline', 'v1', 'air', 'pm25', null, 'BASELINE', 'Labelled persistence baseline. Not a trained ML model; not calibrated.'],
    ['lightgbm_pm25', 'v1-1h', 'air', 'pm25', 1, 'NOT_TRAINED', 'No verified Mumbai historical training extract supplied.'],
    ['lightgbm_pm25', 'v1-3h', 'air', 'pm25', 3, 'NOT_TRAINED', 'No verified Mumbai historical training extract supplied.'],
    ['lightgbm_pm25', 'v1-6h', 'air', 'pm25', 6, 'NOT_TRAINED', 'No verified Mumbai historical training extract supplied.'],
    ['lightgbm_quantile', 'v1', 'air', 'pm25', 3, 'NOT_TRAINED', 'Quantile intervals require a trained model and time-aware evaluation.'],
    ['deterioration_classifier', 'v1', 'air', 'pm25_deterioration', 3, 'NOT_TRAINED', 'Calibration requires historical labelled events.'],
    ['anomaly_detector', 'v1', 'air', 'pm25_anomaly', null, 'NOT_TRAINED', 'No trained anomaly model. Z-score analytical check is exposed separately.'],
  ];
  for (const [name, version, category, target, horizon, status, notes] of models) {
    await query(
      `INSERT INTO model_registry (name, version, category, target, horizon_hours, model_type, status, notes, metrics)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)
       ON CONFLICT (name, version) DO UPDATE SET status=EXCLUDED.status, notes=EXCLUDED.notes`,
      [name, version, category, target, horizon, name, status, notes],
    );
  }
}

async function seedReports(users: Record<string, string>, localities: Map<string, { id: string; lat: number; lng: number }>) {
  const citizenId = users['citizen@enviropulse.local'] ?? null;
  const reports = [
    {
      category: 'air',
      type: 'OPEN_BURNING',
      description:
        'Visible smoke and burning smell from a waste fire beside the service road. Smoke drifting towards residential buildings for about 30 minutes.',
      locality: 'Chembur',
      status: 'VERIFIED',
      verification: 'VERIFIED',
      daysAgo: 0.8,
    },
    {
      category: 'air',
      type: 'DUST',
      description: 'Heavy dust from construction activity without visible screening, covering parked vehicles and the footpath.',
      locality: 'Andheri',
      status: 'AWAITING_VERIFICATION',
      verification: 'UNVERIFIED',
      daysAgo: 1.2,
    },
    {
      category: 'water',
      type: 'SUSPECTED_DISCHARGE',
      description:
        'Grey-green discharge entering the river channel from a pipe. Strong odour; visible foam collecting along the bank.',
      locality: 'Mahim',
      status: 'VERIFIED',
      verification: 'VERIFIED',
      daysAgo: 0.6,
    },
    {
      category: 'water',
      type: 'WATER_DISCOLOURATION',
      description: 'Unusual foam and discolouration near the creek edge. No chemical smell noticed.',
      locality: 'Andheri',
      status: 'AWAITING_VERIFICATION',
      verification: 'UNVERIFIED',
      daysAgo: 2.1,
    },
    {
      category: 'waste',
      type: 'ILLEGAL_DUMPING',
      description: 'Construction debris and household waste dumped on the footpath under the flyover, blocking pedestrian access.',
      locality: 'Govandi',
      status: 'VERIFIED',
      verification: 'VERIFIED',
      daysAgo: 1.4,
    },
    {
      category: 'waste',
      type: 'OPEN_WASTE_BURNING',
      description: 'Garbage burning in an open lot behind the market. Dense smoke for the second evening this week.',
      locality: 'Govandi',
      status: 'VERIFIED',
      verification: 'VERIFIED',
      daysAgo: 2.8,
    },
    {
      category: 'waste',
      type: 'WASTE_ACCUMULATION',
      description: 'Uncollected waste piling near the market entrance for several days. Reported again because the earlier pile was not cleared.',
      locality: 'Govandi',
      status: 'AWAITING_VERIFICATION',
      verification: 'UNVERIFIED',
      daysAgo: 0.4,
    },
    {
      category: 'industrial',
      type: 'VISIBLE_STACK_SMOKE',
      description: 'Dark smoke from an industrial stack, continuing for about 20 minutes. No facility name visible from the public road.',
      locality: 'Trombay',
      status: 'VERIFIED',
      verification: 'VERIFIED',
      daysAgo: 1.1,
    },
    {
      category: 'industrial',
      type: 'CHEMICAL_ODOUR',
      description: 'Sharp chemical odour near the industrial estate boundary. Not possible to identify the source from the public road.',
      locality: 'Chembur',
      status: 'AWAITING_VERIFICATION',
      verification: 'UNVERIFIED',
      daysAgo: 0.3,
    },
  ];

  const ids: Array<{ id: string; category: string; locality: string; status: string }> = [];
  for (const report of reports) {
    const locality = localities.get(report.locality);
    if (!locality) continue;
    const submittedAt = new Date(Date.now() - report.daysAgo * 86_400_000);
    const publicRef = await nextRef('R', 'report_ref_seq');
    const row = await one<{ id: string }>(
      `INSERT INTO environmental_reports
         (public_ref, user_id, category, incident_type, description, location, locality_id, occurred_at,
          submitted_at, status, verification_state, contact_name, contact_email, consent, ai_vision_status,
          is_simulated)
       VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,$8,$9,$9,$10,$11,
         'Demo Citizen','citizen@enviropulse.local',true,'NOT_CONFIGURED',true)
       RETURNING id`,
      [
        publicRef,
        citizenId,
        report.category,
        report.type,
        report.description,
        locality.lng + 0.0008,
        locality.lat - 0.0006,
        locality.id,
        submittedAt.toISOString(),
        report.status,
        report.verification,
      ],
    );
    if (!row) continue;
    // Seeded reports have no photograph, so there is no visual assessment to record.
    ids.push({ id: row.id, category: report.category, locality: report.locality, status: report.status });
  }
  console.log(`Reports: ${ids.length} (simulation-labelled, no fabricated photographs)`);
  return ids;
}

async function seedRegulatory() {
  const naaqs = await one<{ id: string }>(
    `INSERT INTO regulatory_documents
       (title, short_title, authority, published_at, effective_from, category, url, licence, verification_status, summary)
     VALUES ('National Ambient Air Quality Standards, 2009 (CPCB notification)','NAAQS 2009','Central Pollution Control Board',
       '2009-11-18','2009-11-18','air','https://cpcb.nic.in/National-Ambient-Air-Quality-Standards/','Government of India',
       'REFERENCE_ONLY','Ambient air-quality concentration limits and averaging periods. Official applicability must be confirmed against the current notification.')
     ON CONFLICT (title) DO UPDATE SET summary=EXCLUDED.summary RETURNING id`,
  );
  const water = await one<{ id: string }>(
    `INSERT INTO regulatory_documents
       (title, short_title, authority, published_at, effective_from, category, url, licence, verification_status, summary)
     VALUES ('Water Quality Criteria for Designated Best Use (CPCB)','CPCB Water Quality Criteria','Central Pollution Control Board',
       NULL,NULL,'water','https://cpcb.nic.in/','Government of India','REFERENCE_ONLY',
       'Primary water-quality criteria for designated best use, including outdoor bathing. Drinking-water and effluent standards are separate instruments and must not be substituted.')
     ON CONFLICT DO NOTHING RETURNING id`,
  );
  const epRules = await one<{ id: string }>(
    `INSERT INTO regulatory_documents
       (title, short_title, authority, published_at, effective_from, category, url, licence, verification_status, summary)
     VALUES ('Environment (Protection) Rules, 1986 — Schedule VI general standards','EP Rules 1986 Schedule VI','Ministry of Environment, Forest and Climate Change',
       '1986-11-19','1986-11-19','industrial','https://www.indiacode.nic.in/','Government of India','REFERENCE_ONLY',
       'General effluent standards. Industry-specific standards and consent conditions may be stricter and must be checked for the actual facility.')
     ON CONFLICT DO NOTHING RETURNING id`,
  );
  const swm = await one<{ id: string }>(
    `INSERT INTO regulatory_documents
       (title, short_title, authority, published_at, effective_from, category, url, licence, verification_status, summary)
     VALUES ('Solid Waste Management Rules, 2016','SWM Rules 2016','Ministry of Environment, Forest and Climate Change',
       '2016-04-08','2016-04-08','waste','https://cpcb.nic.in/','Government of India','REFERENCE_ONLY',
       'Municipal solid waste duties and prohibitions. This deployment does not encode numeric waste thresholds and does not make automatic violation findings.')
     ON CONFLICT DO NOTHING RETURNING id`,
  );

  const standards: Array<{
    doc: string | undefined;
    category: string;
    parameter: string;
    code: string | null;
    operator: string;
    threshold: number | null;
    max: number | null;
    unit: string;
    averaging: string;
    applicability: string;
    section: string;
    notes: string;
  }> = [
    { doc: naaqs?.id, category: 'air', parameter: 'PM2.5', code: 'pm25', operator: '<=', threshold: 60, max: null, unit: 'µg/m³', averaging: '24 hours', applicability: 'Ambient air, residential/rural/other areas', section: 'NAAQS 2009 — PM2.5, 24-hour limit', notes: 'Annual limit is 40 µg/m³. Instantaneous values are not a valid 24h compliance comparison.' },
    { doc: naaqs?.id, category: 'air', parameter: 'PM10', code: 'pm10', operator: '<=', threshold: 100, max: null, unit: 'µg/m³', averaging: '24 hours', applicability: 'Ambient air, residential/rural/other areas', section: 'NAAQS 2009 — PM10, 24-hour limit', notes: 'Annual limit is 60 µg/m³.' },
    { doc: naaqs?.id, category: 'air', parameter: 'NO2', code: 'no2', operator: '<=', threshold: 80, max: null, unit: 'µg/m³', averaging: '24 hours', applicability: 'Ambient air, residential/rural/other areas', section: 'NAAQS 2009 — NO2, 24-hour limit', notes: 'Annual limit is 40 µg/m³.' },
    { doc: naaqs?.id, category: 'air', parameter: 'SO2', code: 'so2', operator: '<=', threshold: 80, max: null, unit: 'µg/m³', averaging: '24 hours', applicability: 'Ambient air, residential/rural/other areas', section: 'NAAQS 2009 — SO2, 24-hour limit', notes: 'Annual limit is 50 µg/m³.' },
    { doc: naaqs?.id, category: 'air', parameter: 'CO', code: 'co', operator: '<=', threshold: 2, max: null, unit: 'mg/m³', averaging: '8 hours', applicability: 'Ambient air, residential/rural/other areas', section: 'NAAQS 2009 — CO, 8-hour limit', notes: '1-hour limit is 4 mg/m³.' },
    { doc: naaqs?.id, category: 'air', parameter: 'O3', code: 'o3', operator: '<=', threshold: 100, max: null, unit: 'µg/m³', averaging: '8 hours', applicability: 'Ambient air, residential/rural/other areas', section: 'NAAQS 2009 — O3, 8-hour limit', notes: '1-hour limit is 180 µg/m³.' },
    { doc: water?.id, category: 'water', parameter: 'pH', code: 'ph', operator: 'range', threshold: 6.5, max: 8.5, unit: 'pH', averaging: 'grab sample', applicability: 'Outdoor bathing — designated best use', section: 'CPCB Water Quality Criteria — outdoor bathing', notes: 'Reference criteria. Confirm designated use and current applicability.' },
    { doc: water?.id, category: 'water', parameter: 'Dissolved oxygen', code: 'do', operator: '>=', threshold: 5, max: null, unit: 'mg/L', averaging: 'grab sample', applicability: 'Outdoor bathing — designated best use', section: 'CPCB Water Quality Criteria — outdoor bathing', notes: 'Reference criteria. Not a drinking-water standard.' },
    { doc: epRules?.id, category: 'industrial', parameter: 'pH (effluent)', code: null, operator: 'range', threshold: 5.5, max: 9, unit: 'pH', averaging: 'effluent sample', applicability: 'Inland surface water — general standards', section: 'EP Rules 1986, Schedule VI, general standards', notes: 'Reference only. Facility-specific consent conditions may be stricter.' },
    { doc: epRules?.id, category: 'industrial', parameter: 'Suspended solids', code: null, operator: '<=', threshold: 100, max: null, unit: 'mg/L', averaging: 'effluent sample', applicability: 'Inland surface water — general standards', section: 'EP Rules 1986, Schedule VI, general standards', notes: 'Reference only. Not applied automatically to stack readings.' },
    { doc: epRules?.id, category: 'industrial', parameter: 'BOD', code: null, operator: '<=', threshold: 30, max: null, unit: 'mg/L', averaging: 'effluent sample', applicability: 'Inland surface water — general standards', section: 'EP Rules 1986, Schedule VI, general standards', notes: 'Reference only. Facility-specific conditions may differ.' },
    { doc: epRules?.id, category: 'industrial', parameter: 'COD', code: null, operator: '<=', threshold: 250, max: null, unit: 'mg/L', averaging: 'effluent sample', applicability: 'Inland surface water — general standards', section: 'EP Rules 1986, Schedule VI, general standards', notes: 'Reference only.' },
  ];
  for (const standard of standards) {
    if (!standard.doc) continue;
    await query(
      `INSERT INTO regulatory_standards
         (document_id, category, parameter, parameter_code, operator, threshold_value, threshold_max, unit,
          averaging_period, applicability, section_ref, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        standard.doc,
        standard.category,
        standard.parameter,
        standard.code,
        standard.operator,
        standard.threshold,
        standard.max,
        standard.unit,
        standard.averaging,
        standard.applicability,
        standard.section,
        standard.notes,
      ],
    );
  }
  console.log('Regulatory documents and reference standards seeded');
}

async function seedIncidents(
  users: Record<string, string>,
  localities: Map<string, { id: string; lat: number; lng: number }>,
  reports: Array<{ id: string; category: string; locality: string; status: string }>,
) {
  const authorityId = users['authority@enviropulse.local'];
  const officerId = users['officer@enviropulse.local'];
  const analystId = users['analyst@enviropulse.local'];
  const criticalAlerts = await query<{ id: string; category: string; station_id: string | null; locality_id: string | null; summary: string }>(
    `SELECT id, category, station_id, locality_id, summary FROM environmental_alerts
     WHERE state='CRITICAL' ORDER BY triggered_at DESC`,
  );
  const incidents: Array<{
    category: string;
    title: string;
    locality: string;
    status: string;
    risk: string;
    sourceAlert?: string;
    sourceReport?: string;
    assignee?: string;
    description: string;
  }> = [];

  const airAlert = criticalAlerts.find((a) => a.category === 'air');
  const airReport = reports.find((r) => r.category === 'air' && r.status === 'VERIFIED');
  if (airAlert || airReport) {
    incidents.push({
      category: 'air',
      title: 'Elevated PM2.5 screening alert — Chembur',
      locality: 'Chembur',
      status: 'INVESTIGATION',
      risk: 'CRITICAL',
      sourceAlert: airAlert?.id,
      sourceReport: airReport?.id,
      assignee: officerId,
      description:
        'Simulation scenario: elevated PM2.5 screening values at the Chembur demo monitor, supported by a verified open-burning report. An official determination has not been made.',
    });
  }
  const wasteAlert = criticalAlerts.find((a) => a.category === 'waste');
  const wasteReports = reports.filter((r) => r.category === 'waste' && r.status === 'VERIFIED');
  if (wasteAlert || wasteReports.length) {
    incidents.push({
      category: 'waste',
      title: 'Repeated waste dumping and open burning — Govandi',
      locality: 'Govandi',
      status: 'ASSIGNED',
      risk: 'HIGH',
      sourceAlert: wasteAlert?.id,
      sourceReport: wasteReports[0]?.id,
      assignee: officerId,
      description:
        'Two verified citizen reports of dumping and open waste burning within the same locality in seven days. Field verification is required.',
    });
  }
  const waterReport = reports.find((r) => r.category === 'water' && r.status === 'VERIFIED');
  if (waterReport) {
    incidents.push({
      category: 'water',
      title: 'Suspected discharge into Mithi River — Mahim',
      locality: 'Mahim',
      status: 'UNDER_REVIEW',
      risk: 'HIGH',
      sourceReport: waterReport.id,
      assignee: analystId,
      description:
        'Verified report of grey-green discharge and foam. Available demo water-quality readings show low dissolved oxygen. Sampling and source verification are pending.',
    });
  }
  const industrialReport = reports.find((r) => r.category === 'industrial' && r.status === 'VERIFIED');
  if (industrialReport) {
    incidents.push({
      category: 'industrial',
      title: 'Visible stack smoke — Trombay industrial area',
      locality: 'Trombay',
      status: 'MONITORING',
      risk: 'MODERATE',
      sourceReport: industrialReport.id,
      assignee: officerId,
      description:
        'Verified report of dark stack smoke. No facility identity is asserted. Follow-up monitoring is recorded; an official determination has not been made.',
    });
  }

  for (const incident of incidents) {
    const locality = localities.get(incident.locality);
    const publicRef = await nextRef('I', 'incident_ref_seq');
    const row = await one<{ id: string }>(
      `INSERT INTO environmental_incidents
         (public_ref, category, title, description, locality_id, location, status, risk_level, detected_at,
          assigned_to, source_alert_id, source_report_id, created_by, is_simulated)
       VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,$8,$9,now() - interval '6 hours',
         $10,$11,$12,$13,true)
       RETURNING id`,
      [
        publicRef,
        incident.category,
        incident.title,
        incident.description,
        locality?.id ?? null,
        (locality?.lng ?? 72.8777) + 0.0005,
        (locality?.lat ?? 19.076) - 0.0005,
        incident.status,
        incident.risk,
        incident.assignee ?? null,
        incident.sourceAlert ?? null,
        incident.sourceReport ?? null,
        authorityId ?? null,
      ],
    );
    if (!row) continue;
    if (incident.assignee) {
      await query(
        `INSERT INTO incident_assignments (incident_id, assigned_to, assigned_by, note)
         VALUES ($1,$2,$3,'Seeded demonstration assignment')`,
        [row.id, incident.assignee, authorityId ?? null],
      );
    }
    await query(
      `INSERT INTO investigation_notes (incident_id, author_id, note, is_simulated)
       VALUES ($1,$2,$3,true)`,
      [
        row.id,
        incident.assignee ?? authorityId ?? null,
        'Initial review: evidence is simulation-labelled. Confirm source attribution and applicable averaging period before any official determination.',
      ],
    );
    await query(
      `INSERT INTO corrective_actions (incident_id, description, status, due_at, created_by, completed_at, evidence_note, is_simulated)
       VALUES ($1,$2,$3,now() + interval '3 days',$4,$5,$6,true)`,
      [
        row.id,
        incident.category === 'waste'
          ? 'Conduct a field inspection, clear the reported waste, and record follow-up evidence.'
          : incident.category === 'water'
            ? 'Collect a repeat water sample and trace the reported discharge point.'
            : incident.category === 'industrial'
              ? 'Verify the reported stack and review facility-specific monitoring and consent conditions.'
              : 'Inspect the reported burning location, verify the cause, and record follow-up PM2.5 observations.',
        incident.category === 'industrial' ? 'COMPLETED' : 'RECOMMENDED',
        authorityId ?? null,
        incident.category === 'industrial' ? new Date().toISOString() : null,
        incident.category === 'industrial'
          ? 'Follow-up monitoring recorded in the demo scenario; evidence remains simulation-labelled.'
          : null,
      ],
    );
    await query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after)
       VALUES ($1,'INCIDENT_SEEDED','environmental_incident',$2,$3::jsonb)`,
      [authorityId ?? null, row.id, JSON.stringify({ status: incident.status, isSimulated: true })],
    );
    if (incident.sourceReport) {
      await query(
        `UPDATE environmental_reports SET status='LINKED_TO_INVESTIGATION', updated_at=now() WHERE id=$1`,
        [incident.sourceReport],
      );
      await query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after)
         VALUES ($1,'REPORT_STATUS_CHANGED','environmental_report',$2,$3::jsonb)`,
        [authorityId ?? null, incident.sourceReport, JSON.stringify({ status: 'LINKED_TO_INVESTIGATION', incidentId: row.id })],
      );
    }
  }
  console.log(`Incidents: ${incidents.length} (simulation-labelled)`);
}

async function seedAudit(users: Record<string, string>) {
  await query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after)
     VALUES ($1,'DEMO_SEED_COMPLETED','platform','seed',$2::jsonb)`,
    [users['admin@enviropulse.local'] ?? null, JSON.stringify({ demoMode: true, note: 'Deterministic demo dataset seeded' })],
  );
}

async function main() {
  console.log('Seeding प्रकृति demo dataset…');
  const existing = await one<{ count: number }>('SELECT COUNT(*)::int AS count FROM environmental_observations');
  if ((existing?.count ?? 0) > 0 && !process.argv.includes('--force')) {
    if (process.argv.includes('--if-empty')) {
      console.log('Database already seeded; skipping.');
      await closePool();
      return;
    }
    console.error('Database already contains observations. Run `npm run db:reset` before seeding again.');
    await closePool();
    process.exit(1);
  }
  await syncSourceCatalogue();
  await seedPollutants();
  await seedModels();
  const localities = await seedLocalities();
  const users = await seedUsers(localities);
  const stations = await seedStations(localities);
  await seedObservations(stations);
  const reports = await seedReports(users, localities);
  await seedRegulatory();

  // Live weather and CAMS context. These are real external sources, clearly labelled.
  const weather = await ingestOpenMeteoWeather();
  const cams = await ingestOpenMeteoCams();
  console.log(`Weather ingest: ${weather.records} records${weather.message ? ` (${weather.message})` : ''}`);
  console.log(`CAMS ingest: ${cams.records} records${cams.message ? ` (${cams.message})` : ''}`);

  // Risk + alerts from the demo observations, using the same engine as the running app.
  const stationAssessments = await evaluateAllStations();
  const stationAlerts = await syncAlertsFromStationAssessments(stationAssessments);
  // A separate predictive pipeline alert for the Chembur demo station. It uses
  // the persistence baseline and remains explicitly labelled as analytical.
  const predictiveStation = stationAssessments.find((a) => a.station.code === 'DEMO-AIR-07');
  if (predictiveStation) {
    await createOrUpdateAlert(
      {
        ...predictiveStation,
        alertState: 'EARLY_WARNING',
        observedAlertState: 'WATCH',
        predictiveAlertState: 'EARLY_WARNING',
      },
      {
        stationId: predictiveStation.station.id,
        localityId: predictiveStation.station.localityId,
        stationName: predictiveStation.station.name,
        isSimulated: true,
      },
    );
  }
  const wasteAssessments = await evaluateWasteLocalities();
  const wasteAlerts = await syncAlertsFromWasteAssessments(wasteAssessments, true);
  console.log(`Alerts created/updated: ${stationAlerts.length + wasteAlerts.length}`);

  await seedIncidents(users, localities, reports);
  await seedAudit(users);

  await query(
    `INSERT INTO app_config (key, value) VALUES ('seed', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [
      JSON.stringify({
        demoMode: true,
        seededAt: new Date().toISOString(),
        boundary: 'Greater Mumbai (Mumbai City + Mumbai Suburban districts), OSM ODbL',
        note: 'Demo-network observations, seeded reports, alerts, incidents and notifications are simulation-labelled. Imported OpenAQ rows are real measurements; Open-Meteo/CAMS rows are live or modelled as labelled by their source.',
      }),
    ],
  );
  const counts = await one<{ observations: number; stations: number; reports: number; alerts: number; incidents: number }>(
    `SELECT
       (SELECT COUNT(*) FROM environmental_observations)::int AS observations,
       (SELECT COUNT(*) FROM monitoring_stations)::int AS stations,
       (SELECT COUNT(*) FROM environmental_reports)::int AS reports,
       (SELECT COUNT(*) FROM environmental_alerts)::int AS alerts,
       (SELECT COUNT(*) FROM environmental_incidents)::int AS incidents`,
  );
  console.log('Seed complete:', counts);
  console.log(`Demo login: citizen@enviropulse.local / ${DEMO_PASSWORD}`);
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});

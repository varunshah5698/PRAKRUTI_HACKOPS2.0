import { getPlanetEvents, type PlanetEvent } from './city.js';
import { addEvidence, createEvent, type EventActor } from './event-intelligence.js';
import type { EventCategory, EventSeverity } from '../types.js';

const INDIA_CENTER = { lat: 19.076, lng: 72.8777 };

function sourceIdFor(provider: string): string {
  if (provider === 'GDACS') return 'gdacs';
  if (provider === 'USGS') return 'usgs-earthquakes';
  return 'nasa-eonet';
}

function sourceNameFor(provider: string): string {
  if (provider === 'GDACS') return 'GDACS (EC-JRC)';
  if (provider === 'USGS') return 'USGS Earthquake Hazards Program';
  return 'NASA EONET';
}

export function classifyPlanetEvent(event: PlanetEvent): { category: EventCategory; severity: EventSeverity } {
  const text = `${event.kind} ${event.title}`.toLowerCase();
  let category: EventCategory = 'OTHER';
  if (event.provider === 'USGS' || /earthquake|quake/.test(text)) category = 'EARTHQUAKE';
  else if (/cyclone|tropical storm|tc\b|typhoon/.test(text)) category = 'CYCLONE';
  else if (/flood|fl\b/.test(text)) category = 'RIVER_FLOOD';
  else if (/wildfire|forest fire|fire|wf\b/.test(text)) category = 'WILDFIRE';
  else if (/drought|dr\b/.test(text)) category = 'DROUGHT';
  else if (/landslide|mudslide/.test(text)) category = 'LANDSLIDE';
  else if (/heat|temperature/.test(text)) category = 'HEATWAVE';
  else if (/storm|thunder|squall/.test(text)) category = 'SEVERE_STORM';
  else if (/pollution|smog|air quality/.test(text)) category = 'AIR_POLLUTION';
  else if (/rain|precipitation/.test(text)) category = 'EXTREME_RAINFALL';

  let severity: EventSeverity = 'UNKNOWN';
  if (event.provider === 'GDACS') {
    if (/red/i.test(event.kind)) severity = 'CRITICAL';
    else if (/orange/i.test(event.kind)) severity = 'HIGH';
    else if (/green/i.test(event.kind)) severity = 'MODERATE';
  } else if (event.provider === 'USGS' && event.magnitude !== null) {
    if (event.magnitude >= 7) severity = 'CRITICAL';
    else if (event.magnitude >= 6) severity = 'HIGH';
    else if (event.magnitude >= 5) severity = 'MODERATE';
    else severity = 'NORMAL';
  }
  return { category, severity };
}

function freshness(date: string | null): 'LIVE' | 'STALE' | 'HISTORICAL' | 'UNKNOWN' {
  if (!date) return 'UNKNOWN';
  const time = Date.parse(date);
  if (!Number.isFinite(time)) return 'UNKNOWN';
  const age = Date.now() - time;
  if (age <= 6 * 60 * 60_000) return 'LIVE';
  if (age <= 72 * 60 * 60_000) return 'STALE';
  return 'HISTORICAL';
}

export async function ingestDisasterFeeds(actor: EventActor = { type: 'SYSTEM' }): Promise<{
  fetched: number;
  eventsCreated: number;
  eventsExisting: number;
  evidenceCreated: number;
  evidenceExisting: number;
  skipped: number;
  error?: string;
  officialWarnings: { configured: boolean; source: string; reason: string };
  sources: string[];
}> {
  const result = {
    fetched: 0,
    eventsCreated: 0,
    eventsExisting: 0,
    evidenceCreated: 0,
    evidenceExisting: 0,
    skipped: 0,
    officialWarnings: {
      configured: false,
      source: 'IMD',
      reason: 'No verified IMD API key/access is configured. GDACS/EONET are contextual disaster feeds, not local official warnings.',
    },
    sources: ['NASA EONET', 'GDACS', 'USGS'],
  };
  let feed;
  try {
    feed = await getPlanetEvents(INDIA_CENTER.lat, INDIA_CENTER.lng);
  } catch (error) {
    return { ...result, error: error instanceof Error ? error.message : 'Disaster feed unavailable.' };
  }
  const items = [...feed.events, ...feed.earthquakes];
  result.fetched = items.length;
  for (const item of items) {
    if (item.lat === null || item.lng === null) {
      result.skipped += 1;
      continue;
    }
    const sourceId = sourceIdFor(item.provider);
    const { category, severity } = classifyPlanetEvent(item);
    const eventKey = `${sourceId}:${item.id}`;
    const event = await createEvent(
      {
        eventKey,
        category,
        title: item.title,
        description: `${item.provider} · ${item.kind}`,
        severity,
        startAt: item.date,
        lastObservedAt: item.date,
        latitude: item.lat,
        longitude: item.lng,
        detectionSource: sourceId,
        dataQuality: 'SOURCE_REPORTED',
        metadata: { provider: item.provider, kind: item.kind, magnitude: item.magnitude, sourceUrl: item.url },
      },
      actor,
    );
    if (event.created) result.eventsCreated += 1;
    else result.eventsExisting += 1;

    const evidence = await addEvidence(
      event.event.id,
      {
        evidenceType: item.provider === 'GDACS' ? 'OFFICIAL_WARNING' : 'OTHER',
        sourceId,
        sourceName: sourceNameFor(item.provider),
        sourceUrl: item.url,
        sourceRecordId: item.id,
        sourceEntityType: 'EXTERNAL',
        sourceEntityId: item.id,
        title: item.title,
        rawContent: item,
        observedAt: item.date,
        publishedAt: item.date,
        latitude: item.lat,
        longitude: item.lng,
        verificationStatus: 'SOURCE_REPORTED',
        reliabilityClass: item.provider === 'NASA EONET' ? 'AGGREGATOR' : 'OFFICIAL',
        freshnessStatus: freshness(item.date),
        metadata: { provider: item.provider, kind: item.kind, localOfficial: false },
      },
      actor,
    );
    if (evidence.created) result.evidenceCreated += 1;
    else result.evidenceExisting += 1;
  }
  return result;
}

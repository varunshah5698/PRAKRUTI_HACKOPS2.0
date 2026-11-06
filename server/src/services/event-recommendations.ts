import { withTransaction, query } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { appendTimeline, getEventOrThrow, type EventActor } from './event-intelligence.js';
import type {
  EventCategory,
  EventSeverity,
  RecommendationAudience,
  RecommendationUrgency,
} from '../types.js';

export interface RecommendationDraft {
  audience: RecommendationAudience;
  recommendationKey: string;
  title: string;
  action: string;
  reason: string;
  urgency: RecommendationUrgency;
  timeframe: string;
}

const URGENCY_RANK: Record<RecommendationUrgency, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function urgencyFor(severity: EventSeverity): RecommendationUrgency {
  if (severity === 'CRITICAL') return 'CRITICAL';
  if (severity === 'HIGH') return 'HIGH';
  if (severity === 'MODERATE') return 'MEDIUM';
  return 'LOW';
}

function timeframeFor(urgency: RecommendationUrgency): string {
  if (urgency === 'CRITICAL' || urgency === 'HIGH') return 'Immediate (0–6 hours)';
  if (urgency === 'MEDIUM') return 'Next 24 hours';
  return 'Next 72 hours';
}

function citizenAction(category: EventCategory): { key: string; title: string; action: string } {
  switch (category) {
    case 'URBAN_FLOOD':
    case 'RIVER_FLOOD':
    case 'EXTREME_RAINFALL':
      return {
        key: 'citizen-flood-safety',
        title: 'Avoid flood water and low-lying routes',
        action: 'Do not walk or drive through flood water. Avoid underpasses and low-lying roads. Move valuables above expected water level. Follow evacuation instructions only when issued by a verified official channel.',
      };
    case 'CYCLONE':
    case 'SEVERE_STORM':
      return {
        key: 'citizen-storm-safety',
        title: 'Shelter from cyclone or severe storm conditions',
        action: 'Stay indoors away from windows. Secure loose outdoor objects. Avoid the coast, trees and unstable structures. Charge devices and keep a torch and drinking water ready. Follow verified official evacuation instructions.',
      };
    case 'HEATWAVE':
    case 'EXTREME_TEMPERATURE':
      return {
        key: 'citizen-heat-safety',
        title: 'Reduce heat exposure and stay hydrated',
        action: 'Drink water frequently and avoid outdoor exertion during the hottest hours. Check on elderly neighbours and keep children and pets out of parked vehicles. Use a cool, ventilated room where possible.',
      };
    case 'AIR_POLLUTION':
      return {
        key: 'citizen-air-safety',
        title: 'Reduce outdoor exposure to polluted air',
        action: 'Limit prolonged outdoor exertion, especially if you have heart or lung conditions. Keep windows closed during visible smoke or high pollution. Use a well-fitting mask only as an additional measure, not a substitute for reducing exposure.',
      };
    case 'WILDFIRE':
      return {
        key: 'citizen-wildfire-safety',
        title: 'Avoid smoke and follow official wildfire guidance',
        action: 'Stay away from the fire area and avoid smoke plumes. Close windows and doors. Keep routes clear for emergency vehicles. Follow verified evacuation instructions and report new smoke or fire only from a safe distance.',
      };
    case 'EARTHQUAKE':
      return {
        key: 'citizen-earthquake-safety',
        title: 'Protect yourself during aftershocks',
        action: 'Drop, cover and hold on during shaking. Stay away from damaged buildings, glass and loose structures. Expect aftershocks and follow verified official safety instructions.',
      };
    case 'LANDSLIDE':
      return {
        key: 'citizen-landslide-safety',
        title: 'Avoid slopes and unstable ground',
        action: 'Stay away from steep slopes, debris and unstable ground. Follow verified evacuation instructions. Do not enter the affected area to inspect damage.',
      };
    case 'DROUGHT':
      return {
        key: 'citizen-drought-safety',
        title: 'Conserve water and follow local restrictions',
        action: 'Reduce non-essential water use and follow verified local water restrictions. Store drinking water safely and avoid unverified claims about supply restoration.',
      };
    default:
      return {
        key: 'citizen-general-safety',
        title: 'Monitor verified official updates',
        action: 'Avoid the affected area and monitor verified official updates. Do not rely on unverified social media claims for evacuation or safety decisions.',
      };
  }
}

function authorityAction(category: EventCategory): { key: string; title: string; action: string } {
  switch (category) {
    case 'URBAN_FLOOD':
    case 'RIVER_FLOOD':
    case 'EXTREME_RAINFALL':
      return {
        key: 'authority-flood-inspect',
        title: 'Inspect drainage and low-lying locations',
        action: 'Prioritise inspection of reported flooding, drains, underpasses and low-lying roads. Check water levels and access routes where verified data exists. Coordinate with the responsible municipal and state agencies.',
      };
    case 'CYCLONE':
    case 'SEVERE_STORM':
      return {
        key: 'authority-storm-readiness',
        title: 'Check shelters, routes and exposed infrastructure',
        action: 'Review shelter readiness, emergency access routes and exposed infrastructure. Coordinate public advisories through verified official channels and stage response resources.',
      };
    case 'HEATWAVE':
    case 'EXTREME_TEMPERATURE':
      return {
        key: 'authority-heat-response',
        title: 'Activate heat-response checks',
        action: 'Check cooling centres, water points and vulnerable populations. Coordinate public health messaging through verified channels and monitor heat-related reports.',
      };
    case 'AIR_POLLUTION':
      return {
        key: 'authority-air-monitor',
        title: 'Review air-quality evidence and sensitive locations',
        action: 'Review nearby station evidence and sensitive receptors such as schools and hospitals. Consider advisories only through verified official channels. Do not attribute a source without source-apportionment evidence.',
      };
    case 'WILDFIRE':
      return {
        key: 'authority-wildfire-coordinate',
        title: 'Coordinate fire access and smoke advisories',
        action: 'Coordinate with fire and forest authorities, keep access routes clear and monitor smoke exposure. Issue public advisories only through verified official channels.',
      };
    case 'EARTHQUAKE':
      return {
        key: 'authority-earthquake-assess',
        title: 'Assess structural and access impacts',
        action: 'Coordinate structural inspections, access-route checks and aftershock monitoring. Do not declare damage or casualties without verified field evidence.',
      };
    case 'LANDSLIDE':
      return {
        key: 'authority-landslide-assess',
        title: 'Inspect slope stability and access routes',
        action: 'Coordinate slope inspections, closure decisions and access-route checks. Use verified field evidence before issuing an official determination.',
      };
    case 'DROUGHT':
      return {
        key: 'authority-drought-monitor',
        title: 'Monitor water availability and restrictions',
        action: 'Review verified water-level and supply data, coordinate restrictions and monitor vulnerable communities. Do not fabricate supply or reservoir figures.',
      };
    default:
      return {
        key: 'authority-general-review',
        title: 'Review evidence and verify citizen reports',
        action: 'Review the linked evidence and verify nearby citizen reports. Monitor the source feed and update the event only with documented evidence.',
      };
  }
}

export function buildRecommendationDrafts(input: {
  category: EventCategory;
  severity: EventSeverity;
  title: string;
  evidenceCount: number;
}): RecommendationDraft[] {
  const urgency = urgencyFor(input.severity);
  const timeframe = timeframeFor(urgency);
  const citizen = citizenAction(input.category);
  const authority = authorityAction(input.category);
  const reason = `Event “${input.title}” is ${input.severity} (${input.category}); ${input.evidenceCount} linked evidence record(s) support this decision-support recommendation.`;
  return [
    {
      audience: 'CITIZEN',
      recommendationKey: citizen.key,
      title: citizen.title,
      action: citizen.action,
      reason,
      urgency,
      timeframe,
    },
    {
      audience: 'AUTHORITY',
      recommendationKey: authority.key,
      title: authority.title,
      action: authority.action,
      reason,
      urgency,
      timeframe,
    },
  ];
}

export async function generateRecommendations(
  eventId: string,
  actor: EventActor = { type: 'SYSTEM' },
): Promise<{ created: number; existing: number; skipped: boolean; reason?: string; recommendations: Record<string, unknown>[] }> {
  const event = await getEventOrThrow(eventId);
  const evidence = await query<{ id: string }>(
    `SELECT id::text FROM event_evidence WHERE event_id=$1
     UNION
     SELECT ae.evidence_id::text FROM event_analysis_evidence ae
       JOIN event_analysis a ON a.id=ae.analysis_id WHERE a.event_id=$1`,
    [eventId],
  );
  if (evidence.length === 0) {
    return {
      created: 0,
      existing: 0,
      skipped: true,
      reason: 'No linked evidence exists. Recommendations are not generated without evidence.',
      recommendations: [],
    };
  }
  const drafts = buildRecommendationDrafts({
    category: event.category,
    severity: event.severity,
    title: event.title,
    evidenceCount: evidence.length,
  });
  let created = 0;
  let existing = 0;
  await withTransaction(async (client) => {
    for (const draft of drafts) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO action_recommendations
           (event_id, audience, recommendation_key, title, action, reason, urgency, location_label,
            admin_area, location, timeframe, confidence, status, generated_by, methodology)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
           CASE WHEN $11::float8 IS NULL OR $12::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($12,$11),4326)::geography END,
           $10,$13,'PROPOSED','RULE_ENGINE',$14)
         ON CONFLICT (event_id, audience, recommendation_key) DO NOTHING
         RETURNING id`,
        [
          eventId,
          draft.audience,
          draft.recommendationKey,
          draft.title,
          draft.action,
          draft.reason,
          draft.urgency,
          event.admin_area ?? 'Event location',
          event.admin_area ?? null,
          draft.timeframe,
          event.primary_latitude,
          event.primary_longitude,
          evidence.length >= 3 ? 0.8 : 0.6,
          'Rule-based decision support using event category, severity and linked evidence. Not an official order or official determination.',
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        existing += 1;
        continue;
      }
      created += 1;
      for (const item of evidence) {
        await client.query(
          `INSERT INTO recommendation_evidence (recommendation_id, evidence_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [row.id, item.id],
        );
      }
    }
  });
  await audit({
    actorId: actor.id ?? null,
    action: 'EVENT_RECOMMENDATIONS_GENERATED',
    entityType: 'disaster_event',
    entityId: eventId,
    after: { created, existing, evidenceCount: evidence.length },
  });
  await appendTimeline(eventId, actor, {
    entryType: 'NOTE',
    summary: 'Citizen and authority recommendations generated',
    detail: { created, existing, evidenceCount: evidence.length },
    evidenceIds: evidence.map((item) => item.id),
    dedupeKey: `recommendations:${eventId}`,
  });
  return { created, existing, skipped: false, recommendations: await listRecommendations(eventId, null, 'SYSTEM_ADMIN') };
}

export async function listRecommendations(
  eventId: string,
  audience: RecommendationAudience | null,
  viewerRole: string,
): Promise<Record<string, unknown>[]> {
  await getEventOrThrow(eventId);
  const allowedAudience = viewerRole === 'PUBLIC' ? 'CITIZEN' : audience;
  const params: unknown[] = [eventId];
  let audienceClause = '';
  if (allowedAudience) {
    params.push(allowedAudience);
    audienceClause = ` AND r.audience=$2`;
  }
  const rows = await query<Record<string, unknown>>(
    `SELECT r.id, r.event_id, r.audience, r.recommendation_key, r.title, r.action, r.reason, r.urgency,
            r.location_label, r.admin_area, r.timeframe, r.confidence::float8 AS confidence, r.status,
            r.generated_by, r.methodology, r.created_at, r.updated_at,
            COALESCE(array_agg(re.evidence_id ORDER BY re.evidence_id) FILTER (WHERE re.evidence_id IS NOT NULL), '{}') AS evidence_ids
     FROM action_recommendations r
     LEFT JOIN recommendation_evidence re ON re.recommendation_id=r.id
     WHERE r.event_id=$1${audienceClause}
     GROUP BY r.id
     ORDER BY CASE r.urgency WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
              r.created_at DESC`,
    params,
  );
  return rows;
}

export function recommendationUrgencyRank(urgency: RecommendationUrgency): number {
  return URGENCY_RANK[urgency];
}

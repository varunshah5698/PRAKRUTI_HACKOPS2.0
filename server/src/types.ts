export const CATEGORIES = ['air', 'water', 'waste', 'industrial'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  air: 'Air pollution',
  water: 'Water pollution',
  waste: 'Unsafe waste disposal',
  industrial: 'Industrial emissions',
};

export const ROLES = ['PUBLIC', 'FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const AUTHORITY_ROLES: Role[] = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'];

export type AlertState = 'NORMAL' | 'WATCH' | 'EARLY_WARNING' | 'CRITICAL' | 'RECOVERY';
export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

export const EVENT_CATEGORIES = [
  'EXTREME_RAINFALL',
  'URBAN_FLOOD',
  'RIVER_FLOOD',
  'HEATWAVE',
  'EXTREME_TEMPERATURE',
  'CYCLONE',
  'SEVERE_STORM',
  'DROUGHT',
  'LANDSLIDE',
  'EARTHQUAKE',
  'AIR_POLLUTION',
  'WILDFIRE',
  'OTHER',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_SEVERITIES = ['NORMAL', 'MODERATE', 'HIGH', 'CRITICAL', 'UNKNOWN'] as const;
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

export const EVENT_STATUSES = [
  'DETECTED',
  'EVIDENCE_COLLECTED',
  'READY_FOR_REVIEW',
  'AUTHORITY_NOTIFIED',
  'ACKNOWLEDGED',
  'VERIFIED',
  'ACTION_INITIATED',
  'RESOLVED',
  'CLOSED',
  'NOTIFICATION_FAILED',
  'AWAITING_ACKNOWLEDGEMENT',
  'REJECTED',
  'DUPLICATE',
  'UNDER_INVESTIGATION',
  'ESCALATED',
  'UNRESOLVED',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVIDENCE_TYPES = [
  'OFFICIAL_WARNING',
  'WEATHER_OBSERVATION',
  'SATELLITE',
  'HISTORICAL_DATASET',
  'NEWS',
  'CITIZEN_REPORT',
  'AUTHORITY_UPDATE',
  'MODEL_OUTPUT',
  'OTHER',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_VERIFICATION_STATUSES = [
  'OFFICIAL_VERIFIED',
  'INDEPENDENTLY_CORROBORATED',
  'SOURCE_REPORTED',
  'CITIZEN_UNVERIFIED',
  'MODEL_GENERATED',
  'DISPUTED',
  'UNAVAILABLE',
] as const;
export type EvidenceVerificationStatus = (typeof EVIDENCE_VERIFICATION_STATUSES)[number];

export const EVIDENCE_RELIABILITY_CLASSES = [
  'OFFICIAL',
  'PRIMARY_OBSERVATION',
  'INDEPENDENT_CORROBORATION',
  'AGGREGATOR',
  'NEWS',
  'CITIZEN',
  'MODEL',
  'UNKNOWN',
] as const;
export type EvidenceReliabilityClass = (typeof EVIDENCE_RELIABILITY_CLASSES)[number];

export const EVIDENCE_FRESHNESS_STATUSES = ['LIVE', 'STALE', 'HISTORICAL', 'UNKNOWN'] as const;
export type EvidenceFreshnessStatus = (typeof EVIDENCE_FRESHNESS_STATUSES)[number];

export const EVENT_ENTITY_TYPES = [
  'ALERT',
  'INCIDENT',
  'REPORT',
  'WEATHER_OBSERVATION',
  'ENVIRONMENTAL_OBSERVATION',
  'EXTERNAL',
] as const;
export type EventEntityType = (typeof EVENT_ENTITY_TYPES)[number];

export const EVENT_TIMELINE_ENTRY_TYPES = [
  'EVENT_CREATED',
  'EVIDENCE_ADDED',
  'SOURCE_LINKED',
  'CORRELATION_ADDED',
  'STATUS_CHANGED',
  'NOTE',
  'VALIDATION',
] as const;
export type EventTimelineEntryType = (typeof EVENT_TIMELINE_ENTRY_TYPES)[number];

export const EVENT_ACTOR_TYPES = ['SYSTEM', 'USER'] as const;
export type EventActorType = (typeof EVENT_ACTOR_TYPES)[number];

export const RECOMMENDATION_AUDIENCES = ['CITIZEN', 'AUTHORITY'] as const;
export type RecommendationAudience = (typeof RECOMMENDATION_AUDIENCES)[number];

export const RECOMMENDATION_URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RecommendationUrgency = (typeof RECOMMENDATION_URGENCIES)[number];

export const RECOMMENDATION_STATUSES = ['PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'EXPIRED'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];


/**
 * Phase 1 deliberately exposes only the pre-authority lifecycle. Authority
 * transitions are enabled in Phase 4 with verified authority memberships.
 */
export const EVENT_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  DETECTED: ['EVIDENCE_COLLECTED', 'DUPLICATE', 'REJECTED'],
  EVIDENCE_COLLECTED: ['READY_FOR_REVIEW', 'UNDER_INVESTIGATION', 'DUPLICATE', 'REJECTED'],
  READY_FOR_REVIEW: ['UNDER_INVESTIGATION', 'ESCALATED', 'DUPLICATE', 'REJECTED', 'CLOSED'],
  UNDER_INVESTIGATION: ['READY_FOR_REVIEW', 'ESCALATED', 'UNRESOLVED', 'CLOSED'],
  ESCALATED: ['UNDER_INVESTIGATION', 'UNRESOLVED', 'CLOSED'],
  UNRESOLVED: ['UNDER_INVESTIGATION', 'CLOSED'],
  AUTHORITY_NOTIFIED: [],
  ACKNOWLEDGED: [],
  VERIFIED: [],
  ACTION_INITIATED: [],
  RESOLVED: [],
  CLOSED: [],
  NOTIFICATION_FAILED: [],
  AWAITING_ACKNOWLEDGEMENT: [],
  REJECTED: [],
  DUPLICATE: [],
};

export function canTransitionEvent(current: EventStatus, next: EventStatus): boolean {
  return EVENT_TRANSITIONS[current].includes(next);
}


export interface RiskAssessmentResult {
  category: Category;
  entityType: string;
  entityId: string;
  riskScore: number | null;
  riskLevel: RiskLevel;
  confidenceScore: number | null;
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  alertState: AlertState;
  observedAlertState: AlertState;
  predictiveAlertState: AlertState;
  method: string;
  rulesetVersion: string;
  supportingEvidence: Array<Record<string, unknown>>;
  missingInputs: string[];
  factors: Array<{ factor: string; weight: number; contribution: number; detail: string }>;
  calculatedAt: string;
}

export const REPORT_STATUSES = [
  'SUBMITTED',
  'AI_ASSESSED',
  'AWAITING_VERIFICATION',
  'VERIFIED',
  'UNVERIFIED',
  'LINKED_TO_INVESTIGATION',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const INCIDENT_STATUSES = [
  'NEW',
  'UNDER_REVIEW',
  'ASSIGNED',
  'INVESTIGATION',
  'CORRECTIVE_ACTION',
  'MONITORING',
  'RESOLVED',
  'CLOSED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  NEW: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['ASSIGNED'],
  ASSIGNED: ['INVESTIGATION'],
  INVESTIGATION: ['CORRECTIVE_ACTION'],
  CORRECTIVE_ACTION: ['MONITORING'],
  MONITORING: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

export const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  SUBMITTED: ['AI_ASSESSED', 'AWAITING_VERIFICATION', 'UNVERIFIED'],
  AI_ASSESSED: ['AWAITING_VERIFICATION', 'VERIFIED', 'UNVERIFIED'],
  AWAITING_VERIFICATION: ['VERIFIED', 'UNVERIFIED'],
  VERIFIED: ['LINKED_TO_INVESTIGATION'],
  UNVERIFIED: ['AWAITING_VERIFICATION'],
  LINKED_TO_INVESTIGATION: [],
};

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function riskLevelFromScore(score: number | null): RiskLevel {
  if (score === null || Number.isNaN(score)) return 'UNKNOWN';
  if (score < 25) return 'LOW';
  if (score < 50) return 'MODERATE';
  if (score < 75) return 'HIGH';
  return 'CRITICAL';
}

export function confidenceLevelFromScore(score: number | null): 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' {
  if (score === null || Number.isNaN(score)) return 'UNKNOWN';
  if (score < 40) return 'LOW';
  if (score < 70) return 'MEDIUM';
  return 'HIGH';
}

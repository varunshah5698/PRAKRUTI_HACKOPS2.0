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

export type AccessRecord = {
  experiment: 'paywall_access_v1';
  variant: 'A' | 'B' | 'excluded' | 'unassigned';
  source: 'qa' | 'public';
  environment: 'production' | 'local' | 'testflight' | 'review';
  hard: boolean;
  access: 'free' | 'active' | 'inactive' | 'unknown';
  validUntil: string | null;
  enrollmentOpen?: boolean;
  /** Server access mode (20261010120000). Absent: no server answer yet. */
  mode?: AccessMode;
  freeAnalyses?: number;
};
/**
 * 'legacy': the existing free scope (3 free AI analyses, soft paywall).
 * 'hard_after_first_scan': a new install gets one free analysis and one free
 * meal, then needs Kandro Pro (a running trial counts).
 */
export type AccessMode = 'legacy' | 'hard_after_first_scan';
export const FREE_ACCESS: AccessRecord = { experiment: 'paywall_access_v1', variant: 'excluded', source: 'public', environment: 'production', hard: false, access: 'free', validUntil: null };

export const UNRESOLVED_ACCESS: AccessRecord = { ...FREE_ACCESS, variant: 'unassigned', access: 'unknown' };

export function parseAccessRecord(value: unknown): AccessRecord {
  const v = value as AccessRecord;
  if (!v || v.experiment !== 'paywall_access_v1' || !['A', 'B', 'excluded', 'unassigned'].includes(v.variant)
    || !['qa', 'public'].includes(v.source) || !['production', 'local', 'testflight', 'review'].includes(v.environment)
    || typeof v.hard !== 'boolean' || !['free', 'active', 'inactive', 'unknown'].includes(v.access)
    || (v.mode !== undefined && !['legacy', 'hard_after_first_scan'].includes(v.mode))
    || (v.freeAnalyses !== undefined && (!Number.isInteger(v.freeAnalyses) || v.freeAnalyses < 0 || v.freeAnalyses > 3))
    || (v.hard && v.variant !== 'B' && v.mode !== 'hard_after_first_scan') || (v.hard && v.access === 'free')
    || (v.validUntil !== null && (typeof v.validUntil !== 'string' || !Number.isFinite(Date.parse(v.validUntil))))) throw Error('access_response_invalid');
  return v;
}

/** Assignment never follows StoreKit intro eligibility after enrollment. */
export function resolveAccess(record: AccessRecord, paymentPending = false, now = Date.now()) {
  if (record.access === 'active' && record.validUntil && Date.parse(record.validUntil) > now) return 'active' as const;
  if (!record.hard) return record.access === 'unknown' ? 'verification' as const : 'free' as const;
  if (paymentPending) return 'pending' as const;
  if (record.access === 'inactive') return 'locked' as const;
  return 'verification' as const;
}

/** Per-install facts the server cannot know yet (offline, unsynced meal, "Später"). */
export type HardWallLocal = { cohort: boolean; used: boolean };

/** The server decides; only without any server answer does the install flag. */
export function hardWallApplies(record: AccessRecord, local: HardWallLocal) {
  return record.mode ? record.mode === 'hard_after_first_scan' : local.cohort;
}

/**
 * The client side of the hard wall: once the first meal is saved (or the
 * first scan was skipped with "Später") a hard-wall install is locked like a
 * server-enforced hard record until an entitlement is active. The server
 * enforces the same independently; this only closes the gap before sync.
 */
export function applyHardWall(record: AccessRecord, local: HardWallLocal): AccessRecord {
  if (record.hard || !local.used || !hardWallApplies(record, local)) return record;
  return { ...record, hard: true, access: record.access === 'free' ? 'inactive' : record.access };
}

/**
 * A hard-wall install with no entitlement and no meal is still in the first
 * run, even if a crash lost the local stage. One rule for the route guard and
 * the first-scan screen: if they disagree they send each other away forever.
 */
export function firstRunLost(access: { ready: boolean; hardWall: boolean; state: string }, mealCount: number) {
  return access.ready && access.hardWall && access.state === 'free' && mealCount === 0;
}

/** The first meal's reveal (result screen) stays open until the run moves on. */
export function firstMealRevealOpen(path: string, firstRunStage: string | null | undefined) {
  return path === '/result' && firstRunStage === 'scan';
}

// '/first-scan' only offers choices; the scan it leads to is checked as usual.
// '/first-sample' shows a labelled example: no analysis, no saved meal.
const availableWithoutNewUse = new Set(['/paywall', '/account-help', '/saved-meals', '/privacy', '/terms', '/sources', '/account-deletion', '/data-consent', '/onboarding', '/reminder-setup', '/access-setup', '/first-scan', '/first-sample']);
export function routeRequiresAccess(path: string) { return !availableWithoutNewUse.has(path); }

// Return intent is a navigation allowlist, never a URL or an automatic mutation.
const destinations = new Set(['/capture', '/scan', '/today', '/plan', '/progress']);
let returnPath: string | null = null;
export function rememberAccessDestination(path: string) { if (destinations.has(path)) returnPath ??= path; }
export function takeAccessDestination() { const path = returnPath ?? '/today'; returnPath = null; return path; }
export function clearAccessDestination() { returnPath = null; }

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccessMode, HardWallLocal } from '@/services/accessPolicy';

/**
 * Hard paywall after the first scan (owner decision 10/2026), install side.
 *
 * The server is the source of truth (`mode` on the access record). This store
 * only keeps what the server cannot know yet:
 * - `cohort`: this install finished onboarding on a build with the hard wall.
 *   Installs from before have no key and stay on the legacy free scope.
 * - `used`: the one free meal was saved, or the first scan was skipped
 *   ("Später"). Sticky: deleting the meal does not give it back.
 * - `serverMode`: the last server answer for the signed-in account, published
 *   by appAccess; it overrides `cohort` whenever it is known.
 */
const KEY = '@kandro/hard-wall:v1';
export type HardWallState = HardWallLocal & { serverMode: AccessMode | null };
const EMPTY: HardWallState = { cohort: false, used: false, serverMode: null };

let state: HardWallState = EMPTY;
let loaded: Promise<HardWallState> | null = null;
const listeners = new Set<() => void>();
function publish(next: HardWallState) {
  if (next.cohort === state.cohort && next.used === state.used && next.serverMode === state.serverMode) return;
  state = next;
  listeners.forEach(listener => listener());
}
async function persist() {
  await AsyncStorage.setItem(KEY, JSON.stringify({ cohort: state.cohort, used: state.used })).catch(() => undefined);
}

export const getHardWallSnapshot = () => state;
export function subscribeHardWall(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function loadHardWall() {
  loaded ??= (async () => {
    const raw = await AsyncStorage.getItem(KEY).catch(() => null);
    let stored: Partial<HardWallLocal> = {};
    try { stored = raw ? JSON.parse(raw) as Partial<HardWallLocal> : {}; } catch { stored = {}; }
    // A flag set while the read was in flight wins over the older disk value.
    publish({ ...state, cohort: state.cohort || stored.cohort === true, used: state.used || stored.used === true });
    return state;
  })();
  return loaded;
}
/** Onboarding finished on this build: a fresh install joins the hard wall. */
export async function startHardWallInstall() {
  await loadHardWall();
  publish({ ...state, cohort: true, used: false });
  await persist();
}
/** The free meal was saved or the first scan skipped. */
export async function markHardWallUsed() {
  await loadHardWall();
  if (state.used) return;
  // Disk first: the app can die in the reaction to this flag, and the wall
  // has to hold on the next launch.
  await AsyncStorage.setItem(KEY, JSON.stringify({ cohort: state.cohort, used: true })).catch(() => undefined);
  publish({ ...state, used: true });
}
export function setHardWallServerMode(mode: AccessMode | null) {
  publish({ ...state, serverMode: mode });
}
export function hardWallActive(value: HardWallState = state) {
  return value.serverMode ? value.serverMode === 'hard_after_first_scan' : value.cohort;
}

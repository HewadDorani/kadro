import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getDictionary, getLocale } from '@/i18n/active';
import type { SubscriptionTrial } from '@/services/subscription';

const KEY = '@kandro/reminders:v2';
const LEGACY_KEY = '@kandro/evening-reminder:v1';
const OFFER_KEY = '@kandro/reminder-offer-seen:v1';
const PENDING_KEY = '@kandro/reminder-onboarding:v1';
const DECISION_KEY = '@kandro/reminder-decision:v1';
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'evening'] as const;
export type MealSlot = typeof MEAL_SLOTS[number];
export type SlotSetting = { enabled: boolean; hour: number; minute: number };
export const DEFAULT_SLOTS: Record<MealSlot, SlotSetting> = {
  breakfast: { enabled: false, hour: 8, minute: 0 },
  lunch: { enabled: true, hour: 12, minute: 30 },
  dinner: { enabled: true, hour: 18, minute: 30 },
  evening: { enabled: false, hour: 20, minute: 30 },
};
const SLOT_IDS: Record<MealSlot, string> = { breakfast: 'kandro-reminder-breakfast', lunch: 'kandro-reminder-lunch', dinner: 'kandro-reminder-dinner', evening: 'kandro-reminder-evening' };
// Meals open the camera (fastest), the end-of-day check opens a description.
const SLOT_MODE: Record<MealSlot, 'photo' | 'description'> = { breakfast: 'photo', lunch: 'photo', dinner: 'photo', evening: 'description' };
/**
 * Meal reminders are one-off dates for the next week instead of a repeating
 * daily trigger: only then can today's reminder carry today's real numbers
 * while later days stay neutral. Every app start and every saved or removed
 * meal tops the window up again. Someone who stops opening Kandro gets one
 * more week of the reminders they chose, then silence; never a nagging loop.
 */
export const SLOT_OCCURRENCES = 7;
const slotId = (slot: MealSlot, occurrence: number) => occurrence === 0 ? SLOT_IDS[slot] : `${SLOT_IDS[slot]}-${occurrence}`;
const SLOT_OCCURRENCE_IDS = MEAL_SLOTS.flatMap(slot => Array.from({ length: SLOT_OCCURRENCES }, (_, occurrence) => slotId(slot, occurrence)));
export const REMINDER_IDS = ['kandro-meal-reminder', 'kandro-evening-summary', 'kandro-morning-plan', ...Object.values(SLOT_IDS)] as const;
const IDS = REMINDER_IDS;
const OWN_IDS: readonly string[] = [...IDS, ...SLOT_OCCURRENCE_IDS.filter(id => !(IDS as readonly string[]).includes(id))];
const SLOT_MEAL_TYPE: Record<MealSlot, 'Breakfast' | 'Lunch' | 'Dinner' | null> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', evening: null };
/** Today's numbers as the app last saw them; personalises today's reminders only. */
export type ReminderDayStatus = { day: string; remainingCalories: number; remainingProtein: number; loggedTypes: string[] };
let dayStatus: ReminderDayStatus | null = null;
export function setReminderDayStatus(status: ReminderDayStatus | null) { dayStatus = status; }
// Local calendar key without importing date utilities (kept dependency-free).
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
/** Below this many kcal the day counts as complete: no "3 ideas" nudge, only a neutral note. */
export const DAY_COMPLETE_KCAL = 200;
export const REMINDER_HOUR = 20;
export const REMINDER_MINUTE = 30;
export const MORNING_HOUR = 8;
export const MORNING_MINUTE = 0;
export const remindersSupported = Platform.OS !== 'web';
export type ReminderSettings = { enabled: boolean; hour: number; minute: number; mode: 'daily' | 'legacy' | 'meals'; slots?: Record<MealSlot, SlotSetting> };
function validSlots(slots: unknown): slots is Record<MealSlot, SlotSetting> {
  if (!slots || typeof slots !== 'object') return false;
  return MEAL_SLOTS.every(slot => { const value = (slots as Record<string, SlotSetting>)[slot]; return value && typeof value.enabled === 'boolean' && validReminderTime(value.hour, value.minute); });
}
/** Settings as meal slots; an older single daily time becomes the dinner slot. */
export function reminderSlots(settings: ReminderSettings): Record<MealSlot, SlotSetting> {
  if (settings.mode === 'meals' && settings.slots) return settings.slots;
  if (!settings.enabled) return DEFAULT_SLOTS;
  return { ...DEFAULT_SLOTS, lunch: { ...DEFAULT_SLOTS.lunch, enabled: false }, dinner: { enabled: true, hour: settings.hour, minute: settings.minute } };
}
export type ReminderPermission = 'notDetermined' | 'authorized' | 'quiet' | 'denied' | 'unavailable' | 'error';
export type ReminderOnboardingChoice = 'enabled' | 'skipped';
async function recordDecision(change: { permission?: ReminderPermission; onboarding?: ReminderOnboardingChoice }) {
  const previous = JSON.parse(await AsyncStorage.getItem(DECISION_KEY) ?? '{}');
  await AsyncStorage.setItem(DECISION_KEY, JSON.stringify({ ...previous, ...change }));
}
let onboardingPendingSession: boolean | null = null;
let onboardingRevision = 0;
const onboardingListeners = new Set<() => void>();
function publishOnboardingPending(pending: boolean) {
  onboardingRevision += 1;
  if (onboardingPendingSession === pending) return;
  onboardingPendingSession = pending;
  onboardingListeners.forEach(listener => listener());
}
export const getReminderOnboardingSnapshot = () => onboardingPendingSession;
export function subscribeReminderOnboarding(listener: () => void) {
  onboardingListeners.add(listener);
  return () => { onboardingListeners.delete(listener); };
}
let configured = false;
let generation = 0;
let mutation: Promise<unknown> = Promise.resolve();
let accessAllowed = true;
/** Keep the preference; only scheduled/delivered reminders are paused. */
export function setReminderAccessAllowed(allowed: boolean) {
  accessAllowed = allowed;
  if (!allowed && remindersSupported) void serialize(async () => { await cancelOwn(); await cancelReengagement(); }).catch(() => undefined);
}
function serialize<T>(fn: (epoch: number) => Promise<T>) {
  const epoch = generation;
  const next = mutation.then(() => fn(epoch), () => fn(epoch));
  mutation = next.catch(() => undefined);
  return next;
}
const current = (epoch: number) => epoch === generation;

export function configureNotifications() {
  if (!remindersSupported || configured) return;
  configured = true;
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
  applyNotificationChannel();
}
export function applyNotificationChannel() {
  if (Platform.OS !== 'android') return;
  void Notifications.setNotificationChannelAsync('evening-summary', { name: getDictionary().captureExtras.reminderTitle, importance: Notifications.AndroidImportance.DEFAULT, sound: null }).catch(() => undefined);
}
export function permissionState(permission: Notifications.NotificationPermissionsStatus): ReminderPermission {
  const status = permission.ios?.status;
  if (status === Notifications.IosAuthorizationStatus.PROVISIONAL || status === Notifications.IosAuthorizationStatus.EPHEMERAL) return 'quiet';
  if (permission.granted || status === Notifications.IosAuthorizationStatus.AUTHORIZED) return 'authorized';
  if (permission.status === 'denied' || permission.canAskAgain === false || status === Notifications.IosAuthorizationStatus.DENIED) return 'denied';
  return 'notDetermined';
}
export async function getReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported) return 'unavailable';
  try { return permissionState(await Notifications.getPermissionsAsync()); }
  catch { return 'error'; }
}
/** Only from an explicit tap (paywall "allow reminders"); never re-prompts a denial. */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported) return 'unavailable';
  const current = await getReminderPermission();
  if (current !== 'notDetermined') return current;
  configureNotifications();
  try { return permissionState(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: false, allowBadge: false } })); }
  catch { return 'error'; }
}
export function validReminderTime(hour: number, minute: number) {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59;
}
export async function getReminderSettings(): Promise<ReminderSettings> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw) {
    const value = JSON.parse(raw) as ReminderSettings;
    if (typeof value.enabled !== 'boolean' || !validReminderTime(value.hour, value.minute) || !['daily', 'legacy', 'meals'].includes(value.mode) || (value.mode === 'meals' && !validSlots(value.slots))) throw new Error('invalid_reminder_settings');
    return value;
  }
  const old = await AsyncStorage.getItem(LEGACY_KEY);
  return { enabled: old === 'true', hour: REMINDER_HOUR, minute: REMINDER_MINUTE, mode: old === 'true' ? 'legacy' : 'daily' };
}
export async function isEveningReminderEnabled() { return remindersSupported && (await getReminderSettings()).enabled; }
export async function hasSeenReminderOffer() { return (await AsyncStorage.getItem(OFFER_KEY)) === 'true'; }
export async function markReminderOfferSeen() { await AsyncStorage.setItem(OFFER_KEY, 'true'); }
export async function prepareReminderOnboarding() { await AsyncStorage.setItem(PENDING_KEY, 'true'); publishOnboardingPending(true); }
export async function isReminderOnboardingPending() {
  if (onboardingPendingSession !== null) return onboardingPendingSession;
  const revision = onboardingRevision;
  // This optional step must not strand navigation after a storage read failure.
  const pending = (await AsyncStorage.getItem(PENDING_KEY).catch(() => null)) === 'true';
  if (revision === onboardingRevision) publishOnboardingPending(pending);
  return onboardingPendingSession ?? pending;
}
export async function finishReminderOnboarding(choice: ReminderOnboardingChoice = 'skipped') {
  // Publish before navigation/persistence: independent path-triggered reads in
  // the screen and root guard could send Today straight back to this screen.
  publishOnboardingPending(false);
  await recordDecision({ onboarding: choice });
  await markReminderOfferSeen();
  await AsyncStorage.removeItem(PENDING_KEY);
}
async function cancelOwn() {
  await Promise.all(OWN_IDS.map(async id => {
    await Notifications.cancelScheduledNotificationAsync(id);
    await Notifications.dismissNotificationAsync(id);
  }));
}
type ScheduledReminder = { id: string; title: string; body: string; data: Record<string, string>; trigger: Notifications.NotificationTriggerInput };
/**
 * One slot occurrence. Today's breakfast/lunch/dinner reminder names what is
 * really left and leads to the three ideas on Plan; a meal already logged for
 * that slot skips it. An exceeded or nearly complete day, the end-of-day check
 * and every later day get a neutral note that simply opens the capture.
 */
function slotReminder(slot: MealSlot, occurrence: number, at: Date, today: boolean): ScheduledReminder | null {
  const t = getDictionary().captureExtras;
  const label: Record<MealSlot, string> = { breakfast: t.slotBreakfast, lunch: t.slotLunch, dinner: t.slotDinner, evening: t.slotEvening };
  const neutralBody: Record<MealSlot, string> = { breakfast: t.notifyBreakfast, lunch: t.notifyLunch, dinner: t.notifyDinner, evening: t.notifyEvening };
  const trigger = { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, ...(Platform.OS === 'android' ? { channelId: 'evening-summary' } : {}) } as Notifications.NotificationTriggerInput;
  const neutral = { id: slotId(slot, occurrence), title: label[slot], body: neutralBody[slot], data: { route: '/capture', mode: SLOT_MODE[slot] }, trigger };
  const status = today && dayStatus?.day === dayKey(at) ? dayStatus : null;
  const type = SLOT_MEAL_TYPE[slot];
  if (!status || !type) return neutral;
  if (status.loggedTypes.includes(type)) return null;
  const kcal = Math.round(status.remainingCalories);
  if (kcal < DAY_COMPLETE_KCAL) return neutral;
  const protein = Math.max(0, Math.round(status.remainingProtein));
  return { ...neutral, title: protein > 0 ? t.mealReminderLeft(kcal, protein) : t.mealReminderLeftKcal(kcal), body: t.mealReminderIdeas(label[slot]), data: { route: '/plan' } };
}
function mealReminders(slots: Record<MealSlot, SlotSetting>, now = new Date()): ScheduledReminder[] {
  const result: ScheduledReminder[] = [];
  for (const slot of MEAL_SLOTS) {
    if (!slots[slot].enabled) continue;
    const first = new Date(now); first.setHours(slots[slot].hour, slots[slot].minute, 0, 0);
    // A time that already passed today starts the window tomorrow.
    if (first.getTime() <= now.getTime() + 60_000) first.setDate(first.getDate() + 1);
    for (let occurrence = 0; occurrence < SLOT_OCCURRENCES; occurrence++) {
      const at = new Date(first); at.setDate(first.getDate() + occurrence);
      const reminder = slotReminder(slot, occurrence, at, dayKey(at) === dayKey(now));
      if (reminder) result.push(reminder);
    }
  }
  return result;
}
async function schedule(settings: ReminderSettings, epoch: number) {
  await cancelOwn();
  if (!current(epoch) || !accessAllowed) return;
  const t = getDictionary().captureExtras;
  const channel = Platform.OS === 'android' ? { channelId: 'evening-summary' } : {};
  const daily = (hour: number, minute: number) => ({ type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, ...channel }) as Notifications.NotificationTriggerInput;
  const times: ScheduledReminder[] = settings.mode === 'meals' && settings.slots
    ? mealReminders(settings.slots)
    : settings.mode === 'legacy'
      ? [{ id: IDS[1], title: t.notificationTitle, body: t.notificationBody, data: { route: '/capture', mode: 'search' }, trigger: daily(settings.hour, settings.minute) }, { id: IDS[2], title: t.notificationTitle, body: t.notificationBody, data: { route: '/capture', mode: 'search' }, trigger: daily(MORNING_HOUR, MORNING_MINUTE) }]
      : [{ id: IDS[0], title: t.notificationTitle, body: t.notificationBody, data: { route: '/capture', mode: 'search' }, trigger: daily(settings.hour, settings.minute) }];
  for (const time of times) {
    if (!current(epoch) || !accessAllowed) return;
    await Notifications.scheduleNotificationAsync({ identifier: time.id, content: { title: time.title, body: time.body, data: time.data }, trigger: time.trigger });
  }
}
/** Only an explicit user action may ask the OS. No network or push token. */
export function updateReminder(settings: ReminderSettings): Promise<{ enabled: boolean; permission: ReminderPermission }> {
  if (!validReminderTime(settings.hour, settings.minute) || (settings.mode === 'meals' && !validSlots(settings.slots))) return Promise.reject(new Error('invalid_reminder_time'));
  return serialize(async epoch => {
    if (!remindersSupported) return { enabled: false, permission: 'unavailable' };
    configureNotifications();
    if (!current(epoch)) return { enabled: false, permission: 'unavailable' };
    let permission: ReminderPermission = settings.enabled ? await getReminderPermission() : 'authorized';
    if (settings.enabled && permission === 'notDetermined') {
      try { permission = permissionState(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: false, allowBadge: false } })); }
      catch { permission = 'error'; }
    }
    if (!current(epoch)) return { enabled: false, permission: 'unavailable' };
    if (settings.enabled) await recordDecision({ permission });
    if (permission === 'error') return { enabled: false, permission };
    const anySlot = settings.mode !== 'meals' || MEAL_SLOTS.some(slot => settings.slots![slot].enabled);
    const enabled = settings.enabled && anySlot && (permission === 'authorized' || permission === 'quiet');
    if (enabled) await schedule(settings, epoch); else await cancelOwn();
    if (!current(epoch)) return { enabled: false, permission: 'unavailable' };
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...settings, enabled }));
    await markReminderOfferSeen();
    return { enabled, permission };
  });
}
export async function setEveningReminderEnabled(enabled: boolean, _targets?: { calories: number; protein: number }): Promise<boolean> {
  return (await updateReminder({ ...await getReminderSettings(), enabled })).enabled;
}
/**
 * The end-of-day offer promises exactly one calm evening message, so it turns
 * on the end-of-day slot alone (at its saved time) and nothing else.
 */
export async function enableEveningCheckIn(): Promise<boolean> {
  const base = reminderSlots(await getReminderSettings());
  const slots = Object.fromEntries(MEAL_SLOTS.map(slot => [slot, { ...base[slot], enabled: slot === 'evening' }])) as Record<MealSlot, SlotSetting>;
  return (await updateReminder({ enabled: true, mode: 'meals', slots, hour: slots.evening.hour, minute: slots.evening.minute })).enabled;
}
/** Permission changes do not erase the user's choice or re-prompt. */
export function syncEveningReminder(_targets?: { calories: number; protein: number }) {
  return serialize(async epoch => {
    if (!remindersSupported) return;
    configureNotifications();
    const settings = await getReminderSettings();
    const permission = await getReminderPermission();
    if (!current(epoch)) return;
    if (settings.enabled && ['authorized', 'quiet'].includes(permission)) await schedule(settings, epoch);
    else await cancelOwn();
  });
}
const REENGAGE_ID = 'kandro-reengage';
const REENGAGE_KEY = '@kandro/reengage-reminder:v1';
export const REENGAGE_AFTER_DAYS = 3;
export async function isReengagementEnabled() { return (await AsyncStorage.getItem(REENGAGE_KEY).catch(() => null)) !== 'false'; }
async function cancelReengagement() {
  await Notifications.cancelScheduledNotificationAsync(REENGAGE_ID);
  await Notifications.dismissNotificationAsync(REENGAGE_ID);
}
/** Calm daytime only: a pause that ends late at night is answered in the afternoon. */
export function reengagementDate(lastSavedAt: number) {
  const at = new Date(lastSavedAt + REENGAGE_AFTER_DAYS * 86_400_000);
  if (at.getHours() < 9) at.setHours(9, 0, 0, 0);
  else if (at.getHours() >= 20) at.setHours(18, 0, 0, 0);
  return at;
}
/**
 * One gentle note three days after the last saved meal; every new save moves
 * it. Once delivered nothing follows until the next save. Never asks the OS
 * for permission and respects its own switch under Du → Benachrichtigungen.
 */
export function syncReengagementReminder(lastSavedAt: number | null) {
  return serialize(async epoch => {
    if (!remindersSupported) return false;
    try {
      configureNotifications();
      const [enabled, permission] = await Promise.all([isReengagementEnabled(), getReminderPermission()]);
      if (!current(epoch)) return false;
      await cancelReengagement();
      const at = lastSavedAt !== null && Number.isFinite(lastSavedAt) ? reengagementDate(lastSavedAt) : null;
      if (!enabled || !accessAllowed || !at || at.getTime() <= Date.now() || (permission !== 'authorized' && permission !== 'quiet')) return false;
      await Notifications.scheduleNotificationAsync({ identifier: REENGAGE_ID, content: { body: getDictionary().captureExtras.reengageBody, data: { route: '/capture', mode: 'photo' } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, ...(Platform.OS === 'android' ? { channelId: 'evening-summary' } : {}) } });
      return true;
    } catch { return false; }
  });
}
export async function setReengagementEnabled(enabled: boolean, lastSavedAt: number | null) {
  await AsyncStorage.setItem(REENGAGE_KEY, String(enabled));
  await syncReengagementReminder(lastSavedAt);
}
const TRIAL_ID = 'kandro-trial-ending';
const TRIAL_KEY = '@kandro/trial-reminder:v1';
export const TRIAL_REMINDER_LEAD_DAYS = 2;
async function cancelTrial() {
  await Notifications.cancelScheduledNotificationAsync(TRIAL_ID);
  await Notifications.dismissNotificationAsync(TRIAL_ID);
  await AsyncStorage.removeItem(TRIAL_KEY);
}
/** Reconcile the existing StoreKit trial without re-prompting for permission. */
export function scheduleTrialEndingReminder(trial: SubscriptionTrial | null, isCurrent: () => boolean = () => true): Promise<boolean> {
  return serialize(async epoch => {
    if (!remindersSupported || !current(epoch) || !isCurrent()) return false;
    try {
      configureNotifications();
      const expiresAt = trial ? Date.parse(trial.expiresAt) : NaN;
      const reminderAt = expiresAt - TRIAL_REMINDER_LEAD_DAYS * 86_400_000;
      const permission = await getReminderPermission();
      if (!current(epoch) || !isCurrent()) return false;
      // An accelerated sandbox trial, an already-delivered reminder, or a
      // cancelled/expired trial must not be moved to a fictitious future date.
      if (!trial || !trial.willRenew || !Number.isFinite(reminderAt) || reminderAt <= Date.now()
        || (permission !== 'authorized' && permission !== 'quiet')) {
        await cancelTrial();
        return false;
      }
      const t = getDictionary().paywall;
      const body = t.trialReminderBody(new Date(expiresAt).toLocaleDateString(getLocale()));
      const signature = JSON.stringify({ productId: trial.productId, expiresAt, reminderAt, title: t.trialReminderTitle, body });
      const saved = await AsyncStorage.getItem(TRIAL_KEY);
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      if (!current(epoch) || !isCurrent()) return false;
      if (saved === signature && scheduled.some(item => item.identifier === TRIAL_ID)) return true;
      await cancelTrial();
      if (!current(epoch) || !isCurrent()) return false;
      await Notifications.scheduleNotificationAsync({ identifier: TRIAL_ID, content: { title: t.trialReminderTitle, body }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminderAt), ...(Platform.OS === 'android' ? { channelId: 'evening-summary' } : {}) } });
      if (!current(epoch) || !isCurrent()) { await cancelTrial(); return false; }
      await AsyncStorage.setItem(TRIAL_KEY, signature);
      return true;
    } catch { return false; }
  });
}
const TRIAL_ENDING_ID = 'kandro-trial-cancelled-ending';
const TRIAL_ENDING_KEY = '@kandro/trial-cancelled-notice:v1';
const TRIAL_ENDING_LEAD_MS = 86_400_000;
async function cancelTrialEnding() {
  await Notifications.cancelScheduledNotificationAsync(TRIAL_ENDING_ID);
  await AsyncStorage.removeItem(TRIAL_ENDING_KEY);
}
/**
 * A trial that was turned off at Apple still runs to its end. One calm note
 * a day before, with what the person already logged; never for a renewing
 * trial (that one gets the promised reminder above), never re-prompting.
 * `mealsSoFar` is re-read on every reconcile, so the text stays current.
 */
export function scheduleCancelledTrialNotice(trial: SubscriptionTrial | null, mealsSoFar: number, isCurrent: () => boolean = () => true): Promise<boolean> {
  return serialize(async epoch => {
    if (!remindersSupported || !current(epoch) || !isCurrent()) return false;
    try {
      configureNotifications();
      const expiresAt = trial ? Date.parse(trial.expiresAt) : NaN;
      const noticeAt = expiresAt - TRIAL_ENDING_LEAD_MS;
      const permission = await getReminderPermission();
      if (!current(epoch) || !isCurrent()) return false;
      if (!trial || trial.willRenew || !Number.isFinite(noticeAt) || noticeAt <= Date.now()
        || (permission !== 'authorized' && permission !== 'quiet')) {
        await cancelTrialEnding();
        return false;
      }
      const t = getDictionary().retention;
      const count = Math.max(0, Math.floor(mealsSoFar));
      const body = count > 0 ? t.trialEndingPushBody(count) : t.trialEndingPushBodyEmpty;
      const signature = JSON.stringify({ expiresAt, noticeAt, title: t.trialEndingPushTitle, body });
      const saved = await AsyncStorage.getItem(TRIAL_ENDING_KEY);
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      if (!current(epoch) || !isCurrent()) return false;
      if (saved === signature && scheduled.some(item => item.identifier === TRIAL_ENDING_ID)) return true;
      await cancelTrialEnding();
      if (!current(epoch) || !isCurrent()) return false;
      await Notifications.scheduleNotificationAsync({ identifier: TRIAL_ENDING_ID, content: { title: t.trialEndingPushTitle, body }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(noticeAt), ...(Platform.OS === 'android' ? { channelId: 'evening-summary' } : {}) } });
      if (!current(epoch) || !isCurrent()) { await cancelTrialEnding(); return false; }
      await AsyncStorage.setItem(TRIAL_ENDING_KEY, signature);
      return true;
    } catch { return false; }
  });
}
const FIRST_MEAL_KEY = '@kandro/first-meal-celebrated:v1';
const STREAK_KEY = '@kandro/three-day-milestone:v1';
const STREAK_ID = 'kandro-three-days';
/** Shown once per install/account: the first meal ever logged. */
export async function claimFirstMealCelebration() {
  if ((await AsyncStorage.getItem(FIRST_MEAL_KEY).catch(() => 'error')) !== null) return false;
  await AsyncStorage.setItem(FIRST_MEAL_KEY, 'true').catch(() => undefined);
  return true;
}
/** Existing users with history never see the first-meal moment retroactively. */
export async function markFirstMealCelebrated() {
  await AsyncStorage.setItem(FIRST_MEAL_KEY, 'true').catch(() => undefined);
}
/**
 * Third distinct logging day: a short, true summary next morning, framed as the
 * forgiving weekly goal ("3 von 7 Tagen erfasst · Ziel: 4"), never as a streak.
 * Values are computed now from saved meals; nothing is promised that did not happen.
 */
export async function scheduleThreeDayMilestone(averageCalories: number, targetCalories: number, weekDays: number, weekGoal: number) {
  if (!remindersSupported) return 'skipped' as const;
  if ((await AsyncStorage.getItem(STREAK_KEY).catch(() => 'error')) !== null) return 'done' as const;
  await AsyncStorage.setItem(STREAK_KEY, 'true').catch(() => undefined);
  const permission = await getReminderPermission();
  if ((permission !== 'authorized' && permission !== 'quiet') || !accessAllowed) return 'skipped' as const;
  try {
    configureNotifications();
    const t = getDictionary().milestones;
    const morning = new Date(); morning.setDate(morning.getDate() + 1); morning.setHours(8, 30, 0, 0);
    const near = targetCalories > 0 && Math.abs(averageCalories / targetCalories - 1) <= 0.1;
    await Notifications.scheduleNotificationAsync({ identifier: STREAK_ID, content: { title: t.threeDaysTitle(weekDays, weekGoal), body: t.threeDaysBody(averageCalories, targetCalories, near) }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: morning, ...(Platform.OS === 'android' ? { channelId: 'evening-summary' } : {}) } });
    return 'scheduled' as const;
  } catch { return 'skipped' as const; }
}
/** Marks the milestone as handled without a notification (long-time users). */
export async function markThreeDayMilestone() {
  await AsyncStorage.setItem(STREAK_KEY, 'true').catch(() => undefined);
}
export function clearRemindersAfterAccountDeletion() {
  generation += 1;
  publishOnboardingPending(false);
  return serialize(async () => {
    if (remindersSupported) { await cancelOwn(); await cancelTrial().catch(() => undefined); await cancelTrialEnding().catch(() => undefined); await cancelReengagement().catch(() => undefined); await Notifications.cancelScheduledNotificationAsync(STREAK_ID).catch(() => undefined); }
    await AsyncStorage.multiRemove([KEY, LEGACY_KEY, OFFER_KEY, PENDING_KEY, DECISION_KEY, TRIAL_KEY, TRIAL_ENDING_KEY, FIRST_MEAL_KEY, STREAK_KEY, REENGAGE_KEY]);
  });
}
export const clearRemindersForAccountSwitch = clearRemindersAfterAccountDeletion;

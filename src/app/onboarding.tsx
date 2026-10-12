import { prepareAccessEnrollment } from '@/services/appAccess';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { WeightEntry } from '@/components/WeightEntry';
import { KandroMark } from '@/components/KandroMark';
import { PersonalGoalSummary } from '@/components/PersonalGoalSummary';
import { BUILDING_MS, PlanBuilder } from '@/components/PlanBuilder';
import { FIRST_RUN_STEPS, MINIMUM_AGE, ageFromBirthYear, birthYearNeedsBirthday, normalizePersonalGoal, onboardingSteps, personalGoalError, parsePersonalGoalWeight, type OnboardingStep } from '@/services/personalGoal';
import { localDateKey } from '@/utils/date';
import { PrimaryButton, ProgressBar } from '@/components/ui';
import { HERO_MAX_FONT_SCALE, radii, spacing, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { BIOLOGICAL_SEXES, caloriePlan, dailyGoalOffset, calculateDailyTargets, effectiveGoal, estimatedPace, isRateLimited, isTeenProfile, isUnderweight, lowestHealthyWeightKg, weeklyRateLabel } from '@/services/personalization';
import { clearOnboardingDraft, loadOnboardingDraft, saveOnboardingDraft } from '@/services/onboardingDraft';
import { setFirstRunStage } from '@/services/firstRun';
import { startHardWallInstall } from '@/services/hardWall';
import { setAnalyticsCollectionEnabled, trackEvent } from '@/services/telemetry';
import { errorHaptic, selectionHaptic, stepHaptic, successHaptic } from '@/services/haptics';
import { useLanguage } from '@/i18n/LanguageProvider';
import { formatDateParts, formatNumber } from '@/utils/format';
import { parseDecimalInput } from '@/utils/decimalInput';
import { NutritionGoal, UserProfile, WeeklyRateKg } from '@/types/nutrition';
import {
  UNIT_SYSTEMS,
  UnitSystem,
  cmToTotalInches,
  defaultUnitSystem,
  formatWeight,
  kgToPounds,
  poundsToKg,
  totalInchesToCm,
  usesMetricHeight,
  usesMetricWeight,
} from '@/utils/units';
import type { BiologicalSex } from '@/types/nutrition';

type Choice = { label: string; detail: string; icon: keyof typeof Ionicons.glyphMap; disabled?: boolean };


type StepId = OnboardingStep;

const formatNumberPlain = (value: number) => String(Math.round(value * 10) / 10);
/** Calendar arithmetic on YYYY-MM-DD in UTC: no timezone or DST drift. */
function addDaysIso(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function addMonthsIso(iso: string, months: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

type Dict = ReturnType<typeof useLanguage>['t'];

/**
 * Teens never get a deficit, so "lose" is offered as what it really is.
 * Underweight (BMI < 18.5) disables it outright: maintenance is the plan.
 */
function goalChoicesFor(t: Dict, teen: boolean, underweight: boolean): Choice[] {
  return [
    underweight
      ? { label: teen ? t.onboarding.goalLoseTeen : t.onboarding.goalLose, detail: t.onboarding.underweightNotice, icon: 'trending-down', disabled: true }
      : teen
        ? { label: t.onboarding.goalLoseTeen, detail: t.onboarding.goalLoseTeenDetail, icon: 'leaf-outline' }
        : { label: t.onboarding.goalLose, detail: t.onboarding.goalLoseDetail, icon: 'trending-down' },
    { label: t.onboarding.goalMaintain, detail: t.onboarding.goalMaintainDetail, icon: 'remove' },
    { label: t.onboarding.goalGain, detail: t.onboarding.goalGainDetail, icon: 'trending-up' },
  ];
}

/**
 * Asked because it is worth about 115 kcal a day, and offered with a real
 * third option: nobody has to answer to use the app.
 */
function sexChoicesFor(t: Dict): Choice[] {
  return [
    { label: t.onboarding.sexFemale, detail: t.onboarding.sexFemaleDetail, icon: 'female' },
    { label: t.onboarding.sexMale, detail: t.onboarding.sexMaleDetail, icon: 'male' },
    { label: t.onboarding.sexUnspecified, detail: t.onboarding.sexUnspecifiedDetail, icon: 'help' },
  ];
}

function activityChoicesFor(t: Dict): Choice[] {
  return [
    { label: t.onboarding.activityLow, detail: t.onboarding.activityLowDetail, icon: 'desktop-outline' },
    { label: t.onboarding.activityLight, detail: t.onboarding.activityLightDetail, icon: 'walk-outline' },
    { label: t.onboarding.activityHigh, detail: t.onboarding.activityHighDetail, icon: 'barbell-outline' },
  ];
}

function preferenceChoicesFor(t: Dict) {
  return [
    { id: 'high-protein', label: t.onboarding.prefHighProtein },
    { id: 'vegetarian', label: t.onboarding.prefVegetarian },
    { id: 'vegan', label: t.onboarding.prefVegan },
    { id: 'pork-free', label: t.onboarding.prefPorkFree },
    { id: 'lactose-free', label: t.onboarding.prefLactoseFree },
    { id: 'quick', label: t.onboarding.prefQuick },
  ];
}

function copyFor(t: Dict): Record<StepId, { title: string; subtitle: string }> {
  return {
    goal: { title: t.onboarding.goalTitle, subtitle: t.onboarding.goalSubtitle },
    about: { title: t.onboarding.aboutTitle, subtitle: t.onboarding.aboutSubtitle },
    body: { title: t.onboarding.bodyTitle, subtitle: t.onboarding.bodySubtitle },
    target: { title: t.onboarding.targetTitle, subtitle: t.onboarding.targetSubtitle },
    activity: { title: t.onboarding.activityTitle, subtitle: t.onboarding.activitySubtitle },
    preferences: { title: t.onboarding.preferencesTitle, subtitle: t.onboarding.preferencesSubtitle },
    plan: { title: t.onboarding.planTitle, subtitle: t.onboarding.planSubtitle },
  };
}

/** Steps the user may leave without answering (plan editing only). */
const skippableSteps = new Set<StepId>(['preferences']);

/*
 * Kandro is 16+. The guardian-consent flow for 14–15 year olds
 * (services/guardianConsent.ts, supabase/functions/guardian-consent) is
 * intentionally no longer reachable from onboarding: younger people see a
 * friendly block instead. The backend function stays untouched so earlier
 * approvals keep working server-side.
 */
export default function OnboardingScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const compactHeight = windowHeight <= 600;
  const { completeOnboarding, grantWellnessConsent, profile } = useApp();
  const { locale, t } = useLanguage();
  const copy = copyFor(t);
  const sexChoices = sexChoicesFor(t);
  const activityChoices = activityChoicesFor(t);
  const preferenceChoices = preferenceChoicesFor(t);
  const params = useLocalSearchParams<{ edit?: string }>();
  const editing = params.edit === '1' && !!profile.completedAt;
  const [stepIndex, setStepIndex] = useState(0);
  const [goal, setGoal] = useState<NutritionGoal>(() => (editing ? profile.goal : 'lose'));
  const [displayName, setDisplayName] = useState(() => (editing ? profile.displayName : ''));
  const [sex, setSex] = useState<BiologicalSex>(() => (editing ? profile.sex : 'unspecified'));
  // A deliberate answer (incl. "Keine Angabe"), never a silent default: it moves the plan by ~80 kcal.
  const [sexChosen, setSexChosen] = useState(() => editing);
  // Guessed from the device so most people never touch it, but visible and
  // switchable right on the step where it matters.
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(() => (editing ? profile.unitSystem : defaultUnitSystem()));
  // The birth year starts empty: no picker position can become a declared age.
  const currentYear = Number(localDateKey().slice(0, 4));
  const [birthYear, setBirthYear] = useState<number | null>(null);
  const [hadBirthday, setHadBirthday] = useState<boolean | null>(null);
  const needsBirthday = birthYear !== null && birthYearNeedsBirthday(birthYear, currentYear);
  const ageKnown = editing || (birthYear !== null && (!needsBirthday || hadBirthday !== null));
  const age = editing ? profile.age : ageKnown && birthYear !== null ? ageFromBirthYear(birthYear, currentYear, hadBirthday) : 29;
  const [underage, setUnderage] = useState(false);
  const [height, setHeight] = useState(() => (editing ? profile.heightCm : 178));
  const [weight, setWeight] = useState(() => (editing ? profile.weightKg : 78));
  const [weightInputValid, setWeightInputValid] = useState(true);
  const [activity, setActivity] = useState<UserProfile['activityLevel']>(() => (editing ? profile.activityLevel : 'light'));
  // First run asks no pace: the calm one until the plan is edited under "Du".
  const [weeklyRate, setWeeklyRate] = useState<WeeklyRateKg>(() => (editing ? profile.weeklyRateKg : 0.25));
  const teen = ageKnown && isTeenProfile({ age });
  // The weight is known once the body step was shown; the plan never uses a
  // deficit below BMI 18.5, whatever was tapped on the goal step.
  const [bodySeen, setBodySeen] = useState(editing);
  const underweight = bodySeen && isUnderweight({ heightCm: height, weightKg: weight });
  const planGoal = effectiveGoal({ goal, heightCm: height, weightKg: weight });
  const goalChoices = goalChoicesFor(t, teen, underweight);
  const initialPersonalGoal = normalizePersonalGoal(profile);
  const [targetWeightInput, setTargetWeightInput] = useState(() => editing && initialPersonalGoal.targetWeightKg !== null
    ? String(usesMetricWeight(profile.unitSystem) ? initialPersonalGoal.targetWeightKg : Math.round(kgToPounds(initialPersonalGoal.targetWeightKg) * 10) / 10) : '');
  const [targetDateInput, setTargetDateInput] = useState(() => editing ? initialPersonalGoal.targetDate ?? '' : '');
  // While the pace option is chosen the date follows every target change;
  // any other choice is a fixed date the user picked on purpose.
  const [dateFollowsPace, setDateFollowsPace] = useState(!editing);
  const previousUnit = useRef(unitSystem);
  useEffect(() => {
    if (previousUnit.current === unitSystem) return;
    const oldUnit = previousUnit.current; previousUnit.current = unitSystem;
    setTargetWeightInput(value => {
      const parsed = parsePersonalGoalWeight(value);
      if (parsed === null) return value;
      const kg = usesMetricWeight(oldUnit) ? parsed : poundsToKg(parsed);
      return String(Math.round((usesMetricWeight(unitSystem) ? kg : kgToPounds(kg)) * 10) / 10);
    });
  }, [unitSystem]);
  const steps = useMemo(() => onboardingSteps(age, planGoal, editing), [age, planGoal, editing]);
  const targetWeightNumber = targetWeightInput.trim() ? parsePersonalGoalWeight(targetWeightInput) : null;
  const targetWeightKg = targetWeightNumber === null ? (targetWeightInput.trim() ? NaN : null)
    : usesMetricWeight(unitSystem) ? targetWeightNumber : poundsToKg(targetWeightNumber);
  const targetDate = targetDateInput.trim() || null;
  const targetError = age >= 18 && planGoal !== 'maintain' ? personalGoalError(targetWeightKg, targetDate, localDateKey(), height) : null;
  const weightUnit = usesMetricWeight(unitSystem) ? 'kg' : 'lb';
  const currentWeightDisplay = usesMetricWeight(unitSystem) ? weight : kgToPounds(weight);
  const weightStep = usesMetricWeight(unitSystem) ? 0.5 : 1;
  const roundToStep = (value: number) => Math.round(value / weightStep) * weightStep;
  // A wish never points below BMI 18.5 for this height.
  const healthyFloorKg = Math.max(40, lowestHealthyWeightKg(height));
  const healthyFloorDisplay = usesMetricWeight(unitSystem) ? Math.ceil(healthyFloorKg / weightStep) * weightStep : Math.ceil(kgToPounds(healthyFloorKg));
  // A sensible first target: a few kilos in the chosen direction, on the step grid.
  const suggestedTargetWeight = formatNumberPlain(Math.max(healthyFloorDisplay, roundToStep(planGoal === 'gain'
    ? currentWeightDisplay + (usesMetricWeight(unitSystem) ? 3 : 6)
    : currentWeightDisplay - (usesMetricWeight(unitSystem) ? 5 : 10))));
  const nudgeTargetWeight = (direction: -1 | 1) => {
    void selectionHaptic();
    const current = parsePersonalGoalWeight(targetWeightInput) ?? currentWeightDisplay;
    const limits = usesMetricWeight(unitSystem) ? [healthyFloorDisplay, 200] : [healthyFloorDisplay, Math.floor(kgToPounds(200))];
    const next = Math.min(limits[1], Math.max(limits[0], roundToStep(current) + direction * weightStep));
    setTargetWeightInput(formatNumberPlain(next));
  };
  const targetDiffKg = targetWeightKg !== null && Number.isFinite(targetWeightKg) ? targetWeightKg - weight : null;
  const targetDiffLabel = targetDiffKg === null ? '' : t.onboarding.targetDiff(`${targetDiffKg > 0 ? '+' : targetDiffKg < 0 ? '−' : '±'}${formatWeight(Math.abs(targetDiffKg), unitSystem, locale)}`);
  const towardGoal = targetDiffKg !== null && ((planGoal === 'lose' && targetDiffKg < 0) || (planGoal === 'gain' && targetDiffKg > 0));
  const paceWeeks = towardGoal ? Math.min(104, Math.max(1, Math.ceil(Math.abs(targetDiffKg!) / weeklyRate))) : null;
  const today = localDateKey();
  const dateOptions: { key: string; label: string; value: string | null }[] = [
    ...(paceWeeks ? [{ key: 'pace', label: `${t.onboarding.datePace} · ${formatShortDate(addDaysIso(today, paceWeeks * 7))}`, value: addDaysIso(today, paceWeeks * 7) }] : []),
    ...[3, 6, 12].map(months => ({ key: `m${months}`, label: t.onboarding.dateMonths(months), value: addMonthsIso(today, months) })),
    { key: 'none', label: t.onboarding.dateNone, value: null },
  ];
  if (targetDate && !dateOptions.some(option => option.value === targetDate)) {
    dateOptions.unshift({ key: 'saved', label: formatGoalDate(targetDate), value: targetDate });
  }
  const paceDate = paceWeeks ? addDaysIso(today, paceWeeks * 7) : null;
  useEffect(() => {
    if (dateFollowsPace && paceDate && targetDateInput !== paceDate) setTargetDateInput(paceDate);
  }, [dateFollowsPace, paceDate, targetDateInput]);
  // The suggested target arrives with the matching date already chosen.
  const suggestedKg = usesMetricWeight(unitSystem) ? Number(suggestedTargetWeight) : poundsToKg(Number(suggestedTargetWeight));
  const suggestedWeeks = Math.min(104, Math.max(1, Math.ceil(Math.abs(suggestedKg - weight) / weeklyRate)));
  const suggestedTargetDate = planGoal === 'maintain' ? null : addDaysIso(today, suggestedWeeks * 7);
  function formatShortDate(iso: string) {
    return formatDateParts(new Date(`${iso}T12:00:00`), { day: 'numeric', month: 'short' }, locale);
  }
  function formatGoalDate(iso: string) {
    return formatDateParts(new Date(`${iso}T12:00:00`), { day: 'numeric', month: 'short', year: 'numeric' }, locale);
  }
  // First run applies "Proteinreich"; the choice lives in plan editing.
  const [preferences, setPreferences] = useState<string[]>(() => (editing ? profile.preferences : ['high-protein']));
  const [showConsent, setShowConsent] = useState(false);
  const [consentDetails, setConsentDetails] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  // Optional, adults only, never preselected; applied after completion.
  const [analyticsOptIn, setAnalyticsOptIn] = useState(false);
  const [skippedAnything, setSkippedAnything] = useState(false);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  useEffect(() => { trackEvent('setup step viewed', { step, editing }); }, [step, editing]);
  useEffect(() => { if (step === 'body') setBodySeen(true); }, [step]);

  // An app kill mid-setup resumes on the same step with the same answers.
  const [draftReady, setDraftReady] = useState(editing);
  useEffect(() => {
    if (editing) return;
    let active = true;
    void loadOnboardingDraft().then(draft => {
      if (!active) return;
      if (draft) {
        setGoal(draft.goal); setDisplayName(draft.displayName); setSex(draft.sex); setSexChosen(draft.sexChosen);
        setUnitSystem(draft.unitSystem); previousUnit.current = draft.unitSystem;
        setBirthYear(draft.birthYear); setHadBirthday(draft.hadBirthday);
        setHeight(draft.heightCm); setWeight(draft.weightKg); setActivity(draft.activityLevel);
        if (draft.stepIndex > 2) setBodySeen(true);
        // Never resume past the age gate without a known, allowed age.
        const knownAge = draft.birthYear !== null && (!birthYearNeedsBirthday(draft.birthYear, currentYear) || draft.hadBirthday !== null)
          ? ageFromBirthYear(draft.birthYear, currentYear, draft.hadBirthday) : null;
        const maxStep = knownAge !== null && knownAge >= MINIMUM_AGE ? FIRST_RUN_STEPS.length - 1 : 1;
        setStepIndex(Math.min(draft.stepIndex, maxStep));
      }
      setDraftReady(true);
    });
    return () => { active = false; };
  }, [editing]);
  useEffect(() => {
    if (editing || !draftReady) return;
    void saveOnboardingDraft({ stepIndex, goal, displayName, sex, sexChosen, unitSystem, birthYear, hadBirthday, heightCm: height, weightKg: weight, activityLevel: activity });
  }, [editing, draftReady, stepIndex, goal, displayName, sex, sexChosen, unitSystem, birthYear, hadBirthday, height, weight, activity]);

  // A goal makes the plan concrete (and powers the projection): the target
  // step opens with a sensible suggestion the user can adjust or remove.
  const goalSuggested = useRef(editing);
  useEffect(() => {
    if (step !== 'target' || goalSuggested.current) return;
    goalSuggested.current = true;
    if (!targetWeightInput.trim()) { setTargetWeightInput(String(suggestedTargetWeight)); setTargetDateInput(suggestedTargetDate ?? ''); }
  }, [step]);

  const goNext = useCallback(() => { setStepIndex(current => Math.min(steps.length - 1, current + 1)); }, [steps]);
  const goBack = () => {
    void selectionHaptic();
    setStepIndex(current => Math.max(0, current - 1));
  };

  // A selection stays on screen until the user explicitly confirms it with
  // Next. Auto-advancing made a stray tap feel irreversible and prevented a
  // final visual check of the selected answer.
  const selectChoice = (apply: () => void) => {
    void selectionHaptic();
    apply();
  };

  const skipStep = () => {
    void selectionHaptic();
    setSkippedAnything(true);
    if (step === 'preferences') setPreferences([]);
    goNext();
  };

  // New users watch the plan being worked out (the real intermediate values)
  // before it is revealed; editing an existing profile skips straight to it.
  // Derived, not set in an effect: the very first frame of the plan step is
  // already the building view, so the number never flashes before it.
  const [revealed, setRevealed] = useState(false);
  const building = step === 'plan' && !editing && !revealed;
  useEffect(() => {
    if (step !== 'plan') { setRevealed(false); return; }
    if (editing || revealed) return;
    const timer = setTimeout(() => setRevealed(true), BUILDING_MS + 250);
    return () => clearTimeout(timer);
  }, [step, editing, revealed]);
  // A distinct confirmation when the completed plan arrives.
  useEffect(() => {
    if (step !== 'plan' || building) return;
    void successHaptic();
  }, [step, building]);

  const draftProfile = useMemo<UserProfile>(() => ({
    displayName: displayName.trim(),
    sex,
    unitSystem,
    goal: planGoal,
    age,
    heightCm: height,
    weightKg: weight,
    activityLevel: activity,
    weeklyRateKg: weeklyRate,
    preferences,
    ...normalizePersonalGoal({ age, goal: planGoal, targetWeightKg, targetDate, heightCm: height }),
    completedAt: editing ? profile.completedAt : null,
  }), [activity, editing, profile.completedAt, age, displayName, planGoal, height, preferences, sex, unitSystem, weeklyRate, weight, targetWeightKg, targetDate]);
  const startingTargets = useMemo(() => calculateDailyTargets(draftProfile), [draftProfile]);

  const finishOnboarding = async () => {
    await grantWellnessConsent(draftProfile.age);
    const firstRun = !editing && !profile.completedAt;
    // The age was chosen explicitly (birth year), never a picker default.
    if (firstRun) await prepareAccessEnrollment(ageKnown);
    // Value before the offer: the first scan comes next, then the paywall,
    // then the optional reminder question (see services/firstRun.ts).
    // A fresh install on this build: one free analysis, then the hard paywall
    // (the server confirms or overrides this per account; services/hardWall.ts).
    if (firstRun) await startHardWallInstall();
    if (firstRun) await setFirstRunStage('scan');
    await completeOnboarding(draftProfile);
    if (firstRun && analyticsOptIn && draftProfile.age >= 18) void setAnalyticsCollectionEnabled(true).catch(() => false);
    await clearOnboardingDraft();
    trackEvent('onboarding completed', { completion: skippedAnything ? 'skipped' : 'finished' });
    void successHaptic();
    setShowConsent(false);
    // Through Today, so the route guard settles access first and then opens
    // the first-scan prompt.
    router.replace(editing ? '/(tabs)/profile' : '/(tabs)/today');
  };

  const acceptConsent = async () => {
    setConsentBusy(true);
    setConsentError(null);
    try {
      await finishOnboarding();
    } catch {
      void errorHaptic();
      setConsentError(t.onboarding.consentError);
    } finally {
      setConsentBusy(false);
    }
  };

  // Legal pages open above onboarding; the sheet (and its choices) comes back
  // when they are closed instead of being lost.
  const reopenConsent = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!reopenConsent.current) return;
    reopenConsent.current = false;
    setShowConsent(true);
  }, []));
  const openLegal = (path: '/privacy' | '/terms') => {
    reopenConsent.current = true;
    setShowConsent(false);
    router.push(path);
  };

  /**
   * Editing skips the consent sheet: consent was given once and is not
   * re-asked because someone changed their activity level.
   */
  const saveEdits = async () => {
    await completeOnboarding(draftProfile);
    trackEvent('plan edited', { completion: 'finished' });
    router.replace('/(tabs)/profile');
  };

  const primaryAction = async () => {
    void selectionHaptic();
    // Keep the invariant here as well as on the disabled button: navigation
    // must not persist an age the user never chose.
    if (step !== 'goal' && !ageKnown) return;
    if (step === 'about' && !sexChosen) return;
    if (step === 'about' && !editing && age < MINIMUM_AGE) { setUnderage(true); return; }
    if (step === 'body' && !weightInputValid) return;
    if ((step === 'target' || step === 'plan') && targetError) return;
    if (step === 'plan') {
      if (editing) {
        await saveEdits();
        return;
      }
      setConsentError(null);
      setShowConsent(true);
      return;
    }
    goNext();
  };

  const showFooterButton = true;
  // While typing, the keyboard's own Done/Return is the action; the footer
  // would otherwise sit on top of the keyboard and hide the field.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const footerLabel = step === 'plan' ? (editing ? t.onboarding.saveChanges : t.onboarding.openApp) : t.common.next;
  const underweightLose = goal === 'lose' && planGoal === 'maintain';

  if (!draftReady) return <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe} />;

  // Under 16: a friendly stop, no data processed, no consent asked. A typo in
  // the year can be corrected.
  if (underage) {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
        <View style={styles.blockContent}>
          <View style={styles.blockIcon}><KandroMark size={42} /></View>
          <Text accessibilityRole="header" style={styles.title}>{t.onboarding.underageTitle}</Text>
          <Text style={styles.subtitle}>{t.onboarding.underageBody}</Text>
        </View>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <PrimaryButton label={t.onboarding.underageFix} onPress={() => { void selectionHaptic(); setBirthYear(null); setHadBirthday(null); setUnderage(false); }} variant="ghost" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView key={fontScale} edges={['top', 'left', 'right']} style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel={t.common.back}
          accessibilityRole="button"
          accessibilityState={{ disabled: stepIndex === 0 && !editing }}
          disabled={stepIndex === 0 && !editing}
          hitSlop={10}
          onPress={stepIndex === 0 && editing ? () => router.replace('/(tabs)/profile') : goBack}
          style={[styles.backButton, stepIndex === 0 && !editing && styles.invisible]}
        >
          <Ionicons color={colors.text} name="arrow-back" size={22} />
        </Pressable>
        <Text style={styles.stepLabel}>{t.onboarding.step(stepIndex + 1, steps.length)}</Text>
        {skippableSteps.has(step) ? (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={skipStep} style={styles.skipAction}>
            <Text style={styles.skip}>{t.common.skip}</Text>
          </Pressable>
        ) : <View style={styles.skipPlaceholder} />}
      </View>

      <ProgressBar value={(stepIndex + 1) / steps.length} />

      {/* The native keyboard inset follows the system animation exactly; a
          KeyboardAvoidingView re-laid out the whole page in slow motion. */}
      <View style={styles.flex}>
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          key={step}
          contentContainerStyle={[styles.content, compactHeight && styles.contentCompact]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.flex}
        >
          <View style={[styles.headingBlock, compactHeight && styles.headingBlockCompact]}>
            {step === 'goal' ? (
              <View style={[styles.brandMark, compactHeight && styles.brandMarkCompact]}><KandroMark size={compactHeight ? 34 : 42} /></View>
            ) : null}
            <Text accessibilityRole="header" style={[styles.title, compactHeight && styles.titleCompact]}>{step === 'plan' && building ? t.access.buildingTitle : copy[step].title}</Text>
            <Text style={[styles.subtitle, compactHeight && styles.subtitleCompact]}>
              {step === 'plan' && building ? t.access.preparing : copy[step].subtitle}
            </Text>
          </View>

          <View style={[styles.body, compactHeight && styles.bodyCompact]}>
            {step === 'goal' ? (
              <ChoiceList choices={goalChoices} compact={compactHeight} onSelect={(value) => selectChoice(() => setGoal(value))} selected={underweight && goal === 'lose' ? 'maintain' : goal} values={['lose', 'maintain', 'gain'] as NutritionGoal[]} />
            ) : null}

            {step === 'target' ? (
              <View style={styles.rateStep}>
                <UnitToggle onChange={setUnitSystem} value={unitSystem} />
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>{t.onboarding.targetWeightLabel}</Text>
                  {targetWeightInput.trim() === '' ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => { void selectionHaptic(); setDateFollowsPace(true); setTargetWeightInput(String(suggestedTargetWeight)); setTargetDateInput(suggestedTargetDate ?? ''); }}
                      style={({ pressed }) => [styles.addGoal, pressed && styles.choicePressed]}
                    >
                      <Ionicons color={colors.accentText} name="flag-outline" size={20} />
                      <Text style={styles.addGoalText}>{t.onboarding.addTargetWeight}</Text>
                    </Pressable>
                  ) : (
                    <>
                      <View style={styles.measureRow}>
                        <Text numberOfLines={1} style={styles.measureLabel}>{t.onboarding.goalShort}</Text>
                        <View style={styles.measureControls}>
                          <StepperButton compact icon="remove" label={t.common.decreaseUnit(weightUnit)} onPressIn={() => nudgeTargetWeight(-1)} onPressOut={() => undefined} />
                          <View style={styles.measureValueBox}>
                            <TextInput
                              accessibilityLabel={t.onboarding.targetWeightLabel}
                              inputMode="decimal"
                              keyboardType="decimal-pad"
                              maxLength={6}
                              onChangeText={setTargetWeightInput}
                              selectTextOnFocus
                              style={[styles.measureValue, { minWidth: 70, textAlign: 'right', paddingVertical: 4 }]}
                              // Show the language's decimal mark (71,5 in German); parsing accepts both.
                              value={targetWeightInput.replace('.', t.portion.decimalMark)}
                            />
                            <Text style={styles.measureUnit}>{weightUnit}</Text>
                          </View>
                          <StepperButton compact icon="add" label={t.common.increaseUnit(weightUnit)} onPressIn={() => nudgeTargetWeight(1)} onPressOut={() => undefined} />
                        </View>
                      </View>
                      <View style={styles.goalMeta}>
                        <Text style={styles.goalDiff}>{targetDiffLabel}</Text>
                        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { void selectionHaptic(); setTargetWeightInput(''); setTargetDateInput(''); }}>
                          <Text style={styles.linkText}>{t.onboarding.removeTargetWeight}</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>{t.onboarding.rateTitle}</Text>
                  <View style={styles.rateRow}>
                    {([0.25, 0.5] as WeeklyRateKg[]).map((rate) => {
                      const active = weeklyRate === rate;
                      const requested = dailyGoalOffset(draftProfile.goal, rate);
                      return (
                        <Pressable
                          aria-checked={active}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: active }}
                          key={rate}
                          onPress={() => selectChoice(() => setWeeklyRate(rate))}
                          style={({ pressed }) => [styles.rateCard, active && styles.rateCardActive, pressed && styles.choicePressed]}
                        >
                          <Ionicons color={active ? colors.accentText : colors.muted} name={rate === 0.25 ? 'leaf-outline' : 'flash-outline'} size={20} />
                          <Text style={styles.rateValue}>{weeklyRateLabel(draftProfile.goal, rate, t.common, unitSystem)}</Text>
                          <Text style={styles.rateDetail}>
                            {/*
                              Building muscle and losing weight are not the same
                              trade-off: a faster deficit costs adherence, a
                              faster surplus costs body composition.
                            */}
                            {draftProfile.goal === 'gain'
                              ? (rate === 0.25 ? t.onboarding.rateCalmGain : t.onboarding.rateBriskGain)
                              : (rate === 0.25 ? t.onboarding.rateCalm : t.onboarding.rateBrisk)}
                            {' · '}{requested < 0 ? '−' : '+'}{Math.abs(requested)} {t.onboarding.perDay}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {targetWeightInput.trim() !== '' && targetError !== 'weight' ? (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>{t.onboarding.targetDateLabel}</Text>
                    <View style={styles.dateChips}>
                      {dateOptions.map((option) => {
                        const active = (targetDateInput || null) === option.value;
                        return (
                          <Pressable
                            aria-checked={active}
                            accessibilityLabel={option.label}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: active }}
                            key={option.key}
                            onPress={() => { void selectionHaptic(); setDateFollowsPace(option.key === 'pace'); setTargetDateInput(option.value ?? ''); }}
                            style={[styles.dateChip, active && styles.dateChipActive]}
                          >
                            <Text style={[styles.dateChipText, active && styles.dateChipTextActive]}>{option.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {targetDate ? <Text style={styles.goalDiff}>{t.onboarding.dateChosen(formatGoalDate(targetDate))}</Text> : null}
                    {paceWeeks ? <Text style={styles.fieldHint}>{t.onboarding.paceWeeks(paceWeeks)}</Text> : null}
                  </View>
                ) : null}
                <Text style={styles.fieldHint}>{t.onboarding.personalGoalHint}</Text>
                {targetError ? <Text accessibilityLiveRegion="polite" style={styles.consentError}>{targetError === 'weight' ? t.onboarding.targetWeightInvalid : t.onboarding.targetDateInvalid}</Text> : null}
              </View>
            ) : null}

            {step === 'about' && !editing ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>{t.onboarding.birthYearLabel}</Text>
                <BirthYearPicker
                  currentYear={currentYear}
                  onChange={(year) => { setBirthYear(year); setHadBirthday(null); }}
                  value={birthYear}
                />
                {needsBirthday ? (
                  <>
                    <Text style={styles.sectionLabel}>{t.onboarding.birthdayQuestion}</Text>
                    <Segmented
                      labels={[t.onboarding.birthdayYes, t.onboarding.birthdayNo]}
                      onSelect={(value) => selectChoice(() => setHadBirthday(value === 'yes'))}
                      selected={hadBirthday === null ? null : hadBirthday ? 'yes' : 'no'}
                      values={['yes', 'no'] as const}
                    />
                  </>
                ) : null}
                <Text style={styles.fieldHint}>{t.onboarding.birthYearHint}</Text>
              </View>
            ) : null}

            {step === 'about' ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>{t.onboarding.sexLabel}</Text>
                <Segmented
                  labels={sexChoices.map(choice => choice.label)}
                  onSelect={(value) => selectChoice(() => { setSex(value); setSexChosen(true); })}
                  selected={sexChosen ? sex : null}
                  values={BIOLOGICAL_SEXES}
                />
                {sexChosen ? <Text style={styles.fieldHint}>{sexChoices[BIOLOGICAL_SEXES.indexOf(sex)]?.detail}</Text> : null}
              </View>
            ) : null}

            {step === 'about' ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>{t.onboarding.nameOptional}</Text>
                <TextInput
                  accessibilityLabel={t.onboarding.nameTitle}
                  autoCapitalize="words"
                  maxLength={40}
                  onChangeText={setDisplayName}
                  placeholder={t.onboarding.namePlaceholder}
                  placeholderTextColor={colors.muted}
                  returnKeyType="done"
                  submitBehavior="blurAndSubmit"
                  style={styles.smallInput}
                  value={displayName}
                />
              </View>
            ) : null}
            {step === 'about' && editing ? <Text style={styles.subtitle}>{t.onboarding.ageLocked}</Text> : null}
            {step === 'body' ? (
              <View style={styles.section}>
                <UnitToggle onChange={setUnitSystem} value={unitSystem} />
                {usesMetricHeight(unitSystem) ? (
                  <NumberStep label={t.onboarding.heightLabel} layout="row" max={220} min={130} onChange={setHeight} step={1} unit="cm" value={height} />
                ) : (
                  <NumberStep
                    accessibilityUnit="in"
                    format={(inches) => `${Math.floor(inches / 12)}′ ${inches % 12}″`}
                    label={t.onboarding.heightLabel}
                    layout="row"
                    max={cmToTotalInches(220)}
                    min={cmToTotalInches(130)}
                    onChange={(inches) => setHeight(totalInchesToCm(inches))}
                    step={1}
                    unit=""
                    value={cmToTotalInches(height)}
                  />
                )}
                {usesMetricWeight(unitSystem) ? (
                  <WeightEntry
                    compact
                    key={unitSystem}
                    label={t.onboarding.weightLabel}
                    onValidityChange={setWeightInputValid}
                    max={200}
                    min={40}
                    onChange={setWeight}
                    unit="kg"
                    value={weight}
                  />
                ) : (
                  <WeightEntry
                    compact
                    key={unitSystem}
                    label={t.onboarding.weightLabel}
                    onValidityChange={setWeightInputValid}
                    hint={unitSystem === 'uk' ? formatWeight(weight, 'uk', locale) : undefined}
                    max={Math.floor(kgToPounds(200) * 10) / 10}
                    min={Math.ceil(kgToPounds(40) * 10) / 10}
                    onChange={(pounds) => setWeight(poundsToKg(pounds))}
                    unit="lb"
                    value={Math.round(kgToPounds(weight) * 10) / 10}
                  />
                )}
                {underweightLose ? <SafetyNotice text={t.onboarding.underweightNotice} /> : null}
              </View>
            ) : null}

            {step === 'activity' ? (
              <ChoiceList choices={activityChoices} compact={compactHeight} onSelect={(value) => selectChoice(() => setActivity(value))} selected={activity} values={['low', 'light', 'high'] as UserProfile['activityLevel'][]} />
            ) : null}

            {step === 'preferences' ? (
              <View style={styles.chips}>
                {[...preferenceChoices, { id: 'none', label: t.onboarding.prefNone }].map((item) => {
                  const selected = item.id === 'none' ? preferences.length === 0 : preferences.includes(item.id);
                  return (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      key={item.id}
                      onPress={() => {
                        void selectionHaptic();
                        if (item.id === 'none') setPreferences([]);
                        else setPreferences((current) => current.includes(item.id)
                          ? current.filter((entry) => entry !== item.id)
                          : [...current, item.id]);
                      }}
                      style={[styles.chip, selected && styles.chipSelected]}
                    >
                      {selected ? <Ionicons color={colors.onAccent} name="checkmark" size={17} /> : null}
                      <Text style={[styles.chipText, selected && { color: colors.onAccent }]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {step === 'plan' && building ? <View style={styles.buildingStage}><PlanBuilder profile={draftProfile} showcase /></View> : null}
            {step === 'plan' && !building ? <>{underweightLose ? <SafetyNotice text={t.onboarding.underweightNotice} /> : null}<PersonalGoalSummary profile={draftProfile} /><StartingPlan limited={isRateLimited(draftProfile)} profile={draftProfile} targets={startingTargets} />{!editing ? <Text style={styles.fieldHint}>{t.onboarding.laterInProfile}</Text> : null}</> : null}
          </View>
        </ScrollView>

        {showFooterButton && !keyboardOpen && !(step === 'plan' && building) ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            <PrimaryButton
              disabled={(step === 'about' && !ageKnown) || (step === 'about' && !sexChosen) || (step === 'body' && !weightInputValid) || ((step === 'target' || step === 'plan') && !!targetError)}
              icon="arrow-forward"
              label={footerLabel}
              onPress={() => void primaryAction()}
            />
          </View>
        ) : null}
      </View>

      <Modal animationType="fade" onRequestClose={() => setShowConsent(false)} transparent visible={showConsent}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.modalScrim, { paddingTop: insets.top + 12 }]}>
          <View accessibilityViewIsModal style={styles.consentSheet}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.consentContent, { paddingBottom: insets.bottom + 18 }]}>
            <View style={styles.consentIcon}><Ionicons color={colors.onAccent} name="shield-checkmark-outline" size={26} /></View>
            <Text accessibilityRole="header" style={styles.consentTitle}>{t.onboarding.consentTitle}</Text>
            <Text style={styles.consentText}>{consentDetails ? t.onboarding.consentBody : t.onboarding.consentShort}</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: consentDetails }} hitSlop={8} onPress={() => setConsentDetails(value => !value)}>
              <Text style={styles.consentLink}>{consentDetails ? t.onboarding.consentLess : t.onboarding.consentMore}</Text>
            </Pressable>
            <View style={styles.consentLinks}>
              <Pressable accessibilityRole="link" hitSlop={8} onPress={() => openLegal('/privacy')}><Text style={styles.consentLink}>{t.onboarding.consentPrivacy}</Text></Pressable>
              <Pressable accessibilityRole="link" hitSlop={8} onPress={() => openLegal('/terms')}><Text style={styles.consentLink}>{t.onboarding.consentTerms}</Text></Pressable>
            </View>
            {draftProfile.age >= 18 ? (
              <View style={styles.analyticsRow}>
                <Text style={styles.analyticsText}>{t.onboarding.analyticsOptIn}</Text>
                <Switch
                  accessibilityLabel={t.onboarding.analyticsOptIn}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: analyticsOptIn, disabled: consentBusy }}
                  disabled={consentBusy}
                  onValueChange={setAnalyticsOptIn}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  value={analyticsOptIn}
                />
              </View>
            ) : null}
            {consentError ? <Text accessibilityLiveRegion="assertive" style={styles.consentError}>{consentError}</Text> : null}
            <PrimaryButton
              disabled={consentBusy}
              icon="checkmark"
              label={consentBusy ? t.common.moment : t.onboarding.consentAccept}
              onPress={() => void acceptConsent()}
            />
            <PrimaryButton disabled={consentBusy} label={t.common.back} onPress={() => setShowConsent(false)} variant="ghost" />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function SafetyNotice({ text }: { text: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View accessibilityLiveRegion="polite" style={styles.teenRow}>
      <Ionicons color={colors.accentText} name="shield-checkmark-outline" size={16} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

const YEAR_ROW = 48;
/**
 * A scrolling list of years, nothing preselected. It opens around a typical
 * adult year so most people scroll a little, and every row is a real radio.
 */
function BirthYearPicker({ currentYear, onChange, value }: { currentYear: number; onChange: (year: number) => void; value: number | null }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  const years = useMemo(() => Array.from({ length: 91 }, (_, index) => currentYear - 10 - index), [currentYear]);
  const initialIndex = value === null ? years.indexOf(currentYear - 25) : Math.max(0, years.indexOf(value));
  return (
    <View accessibilityLabel={t.onboarding.birthYearLabel} accessibilityRole="radiogroup" style={styles.yearBox}>
      <ScrollView contentOffset={{ x: 0, y: Math.max(0, (initialIndex - 2) * YEAR_ROW) }} nestedScrollEnabled showsVerticalScrollIndicator>
        {years.map(year => {
          const active = value === year;
          return (
            <Pressable
              aria-checked={active}
              accessibilityLabel={String(year)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              key={year}
              onPress={() => { void selectionHaptic(); onChange(year); }}
              style={[styles.yearRow, active && styles.yearRowActive]}
            >
              <Text style={[styles.yearText, active && styles.yearTextActive]}>{year}</Text>
              {active ? <Ionicons color={colors.accentText} name="checkmark-circle" size={20} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}


function ChoiceList<T extends string>({ choices, compact = false, onSelect, selected, values }: { choices: Choice[]; compact?: boolean; onSelect: (choice: T) => void; selected: T; values: T[] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.choiceList}>
      {choices.map((choice, index) => {
        const value = values[index];
        const active = value === selected;
        return (
          <Pressable
            aria-checked={active}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, disabled: !!choice.disabled }}
            disabled={choice.disabled}
            key={value}
            onPress={() => onSelect(value)}
            style={({ pressed }) => [styles.choice, compact && styles.choiceCompact, active && styles.choiceActive, choice.disabled && styles.choiceDisabled, pressed && styles.choicePressed]}
          >
            <View style={[styles.choiceIcon, compact && styles.choiceIconCompact, active && styles.choiceIconActive]}>
              <Ionicons color={active ? colors.onAccent : colors.text} name={choice.icon} size={22} />
            </View>
            <View style={styles.choiceTextBlock}>
              <Text style={styles.choiceTitle}>{choice.label}</Text>
              <Text style={styles.choiceDetail}>{choice.detail}</Text>
            </View>
            <Ionicons color={active ? colors.accentText : colors.border} name={active ? 'checkmark-circle' : 'ellipse-outline'} size={24} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** iOS-style segmented control for short, mutually exclusive answers. */
function Segmented<T extends string>({ labels, onSelect, selected, values }: { labels: string[]; onSelect: (value: T) => void; selected: T | null; values: readonly T[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View accessibilityRole="radiogroup" style={styles.segment}>
      {values.map((value, index) => {
        const active = value === selected;
        return (
          <Pressable
            aria-checked={active}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            key={value}
            onPress={() => onSelect(value)}
            style={[styles.segmentOption, active && styles.segmentOptionActive]}
          >
            <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{labels[index]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A tap steps by one, holding accelerates. Without the hold, moving the weight
 * from the default to a real value would cost dozens of taps.
 */
/**
 * Three small pills rather than a settings menu: the moment somebody is asked
 * for their height is the moment they know which unit they think in.
 */
function UnitToggle({ onChange, value }: { onChange: (system: UnitSystem) => void; value: UnitSystem }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  const labels: Record<UnitSystem, string> = {
    metric: t.onboarding.unitMetric,
    us: t.onboarding.unitUs,
    uk: t.onboarding.unitUk,
  };
  return (
    <View style={styles.segment}>
      {UNIT_SYSTEMS.map((system) => {
        const active = system === value;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={system}
            onPress={() => { void selectionHaptic(); onChange(system); }}
            style={[styles.segmentOption, active && styles.segmentOptionActive]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{labels[system]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function NumberStep({ editable = false, accessibilityUnit, format, label, layout = 'hero', max, min, onChange, step, unit, value }: { editable?: boolean; accessibilityUnit?: string; format?: (value: number) => string; label?: string; layout?: 'hero' | 'row'; max: number; min: number; onChange: (value: number) => void; step: number; unit: string; value: number }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t, locale } = useLanguage();
  const [editingNumber, setEditingNumber] = useState(false);
  const [draft, setDraft] = useState('');
  const parsed = parseDecimalInput(draft, min, max);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gesture = useRef(0);
  const latest = useRef(value);
  latest.current = value;

  /**
   * Every value ticks, not just the first.
   *
   * A held stepper ran from 78 to 95 kg in silence after one tap's feedback,
   * which is the opposite of what the vibration is for: it is how you feel the
   * number moving without watching it. Holding at a bound stays silent: there
   * is nothing to feel when nothing changed.
   */
  const apply = useCallback((direction: -1 | 1, repeating = false) => {
    // A value that came back through a unit conversion does not sit on the step
    // grid: 176 lb is 79.8 kg, and adding a whole step to that kept the .8 for
    // ever, so only the digits in front of the separator ever moved. The first
    // press lands on the neighbouring whole step in the direction pressed;
    // after that it moves a full step at a time.
    const steps = latest.current / step;
    const onGrid = Math.abs(steps - Math.round(steps)) < 1e-9;
    const raw = onGrid
      ? latest.current + direction * step
      : (direction > 0 ? Math.ceil(steps) : Math.floor(steps)) * step;
    const next = Math.min(max, Math.max(min, Math.round(raw * 1e10) / 1e10));
    if (next === latest.current) return;
    latest.current = next;
    void stepHaptic(repeating);
    onChange(next);
  }, [max, min, onChange, step]);

  const stop = useCallback(() => {
    gesture.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const start = (direction: -1 | 1) => {
    // A fast second tap used to replace the timer reference without cancelling
    // the first timer. That orphan kept changing age or height after release.
    stop();
    const activeGesture = gesture.current;
    apply(direction);
    let delay = 340;
    const tick = () => {
      if (activeGesture !== gesture.current) return;
      apply(direction, true);
      // Faster than this turns distinct taps into a cheap continuous buzz.
      delay = Math.max(72, delay * 0.82);
      timer.current = setTimeout(tick, delay);
    };
    timer.current = setTimeout(tick, delay);
  };

  useEffect(() => stop, [stop]);

  const display = String(format ? format(value) : value);

  // One calm card row (label · − value +): several measurements fit one
  // screen without a 100 pt number pushing the rest below the fold.
  if (layout === 'row') {
    return (
      <View style={styles.measureRow}>
        {label ? <Text numberOfLines={1} style={styles.measureLabel}>{label}</Text> : null}
        <View style={styles.measureControls}>
          <StepperButton compact icon="remove" label={t.common.decreaseUnit(accessibilityUnit ?? unit)} onPressIn={() => start(-1)} onPressOut={stop} />
          <View style={styles.measureValueBox}>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.measureValue}>{display}</Text>
            {unit ? <Text style={styles.measureUnit}>{unit}</Text> : null}
          </View>
          <StepperButton compact icon="add" label={t.common.increaseUnit(accessibilityUnit ?? unit)} onPressIn={() => start(1)} onPressOut={stop} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.numberStep}>
      <View style={styles.numberCenter}>
        <View style={styles.numberRow}>
          {editable ? <Pressable style={styles.numberValue} accessibilityRole="button" accessibilityLabel={`${t.onboarding.editWeight}: ${display} ${accessibilityUnit ?? unit}`} onPress={() => { stop(); setDraft(formatNumber(value, locale)); setEditingNumber(true); }}>
            <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} adjustsFontSizeToFit numberOfLines={1} style={[styles.number, numberSize(display)]}>{display}</Text>
          </Pressable> : <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} adjustsFontSizeToFit numberOfLines={1} style={[styles.number, styles.numberValue, numberSize(display)]}>{display}</Text>}
          {unit ? <Text style={styles.numberUnit}>{unit}</Text> : null}
        </View>
      </View>
      <Text style={styles.adjustHint}>{editable ? t.onboarding.exactWeightHint : t.onboarding.adjustHint}</Text>
      <View style={styles.numberControls}>
        <StepperButton icon="remove" label={t.common.decreaseUnit(accessibilityUnit ?? unit)} onPressIn={() => start(-1)} onPressOut={stop} />
        <StepperButton icon="add" label={t.common.increaseUnit(accessibilityUnit ?? unit)} onPressIn={() => start(1)} onPressOut={stop} />
      </View>
      <Modal visible={editingNumber} transparent animationType="fade" onRequestClose={() => setEditingNumber(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.numberEditorScrim}>
          <View accessibilityViewIsModal style={styles.numberEditor}>
            <Text accessibilityRole="header" style={styles.numberEditorTitle}>{t.onboarding.editWeight} ({accessibilityUnit ?? unit})</Text>
            <TextInput accessibilityLabel={t.onboarding.editWeight} autoFocus selectTextOnFocus keyboardType="decimal-pad" maxLength={6} value={draft} onChangeText={setDraft} style={styles.guardianInput} />
            <Text accessibilityLiveRegion="polite" style={styles.adjustHint}>{t.onboarding.weightRange.replace('{min}', formatNumber(min, locale)).replace('{max}', formatNumber(max, locale))} {accessibilityUnit ?? unit}</Text>
            <PrimaryButton label={t.common.save} disabled={parsed === null} onPress={() => { if (parsed === null) return; onChange(parsed); setEditingNumber(false); }} />
            <PrimaryButton label={t.common.cancel} variant="ghost" onPress={() => setEditingNumber(false)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/**
 * adjustsFontSizeToFit is an iOS-only prop, so on every other surface a long
 * value keeps its full size: "12 st 4 lb" at 76pt overlapped both stepper
 * buttons by 46 points. Sizing from the string is deterministic and works
 * everywhere.
 */
function numberSize(display: string) {
  if (display.length <= 3) return { fontSize: 100, lineHeight: 112 };
  if (display.length <= 6) return { fontSize: 70, lineHeight: 80 };
  return { fontSize: 46, lineHeight: 56 };
}

function StepperButton({ compact = false, icon, label, onPressIn, onPressOut }: { compact?: boolean; icon: 'add' | 'remove'; label: string; onPressIn: () => void; onPressOut: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={compact ? 6 : undefined}
      style={({ pressed }) => [compact ? styles.roundButton : styles.numberButton, pressed && styles.numberButtonPressed]}
    >
      <Ionicons color={colors.text} name={icon} size={compact ? 20 : 26} />
    </Pressable>
  );
}

function StartingPlan({ limited, profile, targets }: { limited: boolean; profile: UserProfile; targets: ReturnType<typeof calculateDailyTargets> }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { locale, t } = useLanguage();
  return (
    <View style={styles.startingCard}>
      <Text style={styles.cardEyebrow}>{t.onboarding.dailyGoal}</Text>
      <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} adjustsFontSizeToFit numberOfLines={1} style={styles.calories}>{new Intl.NumberFormat(locale).format(targets.calories)}</Text>
      <Text style={styles.caloriesLabel}>{t.onboarding.kilocalories}</Text>
      {!isTeenProfile(profile) ? (
        <View style={styles.pacePill}>
          <Ionicons color={colors.accentText} name={profile.goal === 'gain' ? 'trending-up' : profile.goal === 'lose' ? 'trending-down' : 'remove'} size={15} />
          <Text style={styles.pacePillText}>{estimatedPace(profile.goal, profile.weeklyRateKg, t.common, profile.unitSystem)}</Text>
        </View>
      ) : <Text style={styles.planStatLabel}>{t.onboarding.teenPace}</Text>}
      <View style={styles.divider} />
      <View style={styles.macroRow}>
        {([
          [t.common.protein, targets.protein, colors.macroProtein],
          [t.onboarding.macroCarbs, targets.carbs, colors.macroCarbs],
          [t.onboarding.macroFat, targets.fat, colors.macroFat],
        ] as const).map(([label, grams, tint]) => (
          <View key={label} style={styles.macroTile}>
            <View style={[styles.macroDot, { backgroundColor: tint }]} />
            <Text style={styles.macroValue}>{grams} g</Text>
            <Text numberOfLines={1} style={styles.macroLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.adaptsRow}>
        <Ionicons color={colors.accentText} name="sync" size={18} />
        <Text style={styles.adaptsText}>{t.onboarding.adapts}</Text>
      </View>
      {limited ? (
        <View style={styles.limitRow}>
          <Ionicons color={colors.attentionText} name="information-circle-outline" size={16} />
          <Text style={styles.limitText}>
            {t.onboarding.rateLimited}
          </Text>
        </View>
      ) : null}
      {isTeenProfile(profile) ? (
        <View style={styles.teenRow}>
          <Ionicons color={colors.accentText} name="shield-checkmark-outline" size={16} />
          <Text style={styles.teenText}>{t.onboarding.teenPlanNotice}</Text>
        </View>
      ) : null}
      <Text style={styles.safetyText}>
        {!isTeenProfile(profile) ? `${t.onboarding.appliedOffset(Math.round(caloriePlan(profile).appliedOffset).toLocaleString(locale, { signDisplay: 'always' }))} ` : ''}{t.onboarding.safety}
      </Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 20 },
  flex: { flex: 1 },
  topBar: { minHeight: 54, paddingVertical: 8, gap: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  invisible: { opacity: 0 },
  stepLabel: { ...typeScale.footnote, flex: 1, color: colors.muted, fontWeight: '600', textAlign: 'center' },
  skipAction: { flexShrink: 1, maxWidth: '38%' },
  skip: { ...typeScale.footnote, color: colors.muted, fontWeight: '600', textAlign: 'right' },
  skipPlaceholder: { width: 92 },
  content: { flexGrow: 1, paddingTop: 26, paddingBottom: 8 },
  contentCompact: { paddingTop: 12, paddingBottom: 6 },
  headingBlock: { gap: 10 },
  headingBlockCompact: { gap: 6 },
  brandMark: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  brandMarkCompact: { width: 34, height: 34, marginBottom: 2 },
  title: { ...typeScale.display, color: colors.text, fontWeight: '700' },
  titleCompact: { ...typeScale.title1 },
  subtitle: { ...typeScale.body, color: colors.muted, maxWidth: 360 },
  subtitleCompact: { ...typeScale.subhead },
  body: { flexGrow: 1, justifyContent: 'flex-start', gap: 22, paddingVertical: 22 },
  bodyCompact: { justifyContent: 'flex-start', paddingVertical: 12 },
  footer: { gap: 12, paddingTop: 8, backgroundColor: colors.background },
  choiceList: { gap: 12 },
  choice: { minHeight: 82, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 13 },
  choiceCompact: { minHeight: 70, borderRadius: 20, padding: 10, gap: 10 },
  choiceActive: { borderColor: colors.accentText, backgroundColor: colors.neutralSoft },
  choicePressed: { transform: [{ scale: 0.985 }] },
  choiceDisabled: { opacity: 0.55 },
  choiceIcon: { width: 48, height: 48, borderRadius: 18, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  choiceIconCompact: { width: 42, height: 42, borderRadius: 15 },
  choiceIconActive: { backgroundColor: colors.accent },
  choiceTextBlock: { flex: 1, minWidth: 0, gap: 3 },
  choiceTitle: { ...typeScale.label, color: colors.text, fontWeight: '700' },
  choiceDetail: { ...typeScale.footnote, color: colors.muted },
  fieldLabel: { ...typeScale.callout, color: colors.text, fontWeight: '600' },
  nameField: { gap: 7 },
  nameInput: { ...typeScale.title2, minHeight: 64, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontWeight: '600', paddingHorizontal: 18 },
  ageStep: { width: '100%', alignItems: 'center', gap: 4 },
  ageConfirmation: { minHeight: 52, alignSelf: 'stretch', borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  ageConfirmationChecked: { borderColor: colors.accentText, backgroundColor: colors.neutralSoft },
  ageConfirmationText: { ...typeScale.callout, color: colors.text, fontWeight: '700' },
  numberStep: { width: '100%', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 24 },
  // 'stretch', not 'center': centring shrank the stepper to its content width,
  // and its space-between then pressed the number flat against the − and +
  // circles with no gap at all.
  unitStep: { flex: 1, gap: 18, paddingBottom: 10 },
  rateStep: { gap: 22 },
  unitToggle: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  unitStepValue: { flex: 1, minHeight: 292, justifyContent: 'center', borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 18 },
  unitOption: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  unitOptionActive: { borderColor: colors.accentText, backgroundColor: colors.accent },
  unitLabel: { ...typeScale.footnote, color: colors.muted, fontWeight: '600' },
  unitLabelActive: { color: colors.onAccent },
  numberControls: { width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 14 },
  numberButton: { flex: 1, maxWidth: 240, height: 72, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  numberButtonPressed: { backgroundColor: colors.neutralSoft, transform: [{ scale: 0.94 }] },
  numberCenter: { width: '100%', minHeight: 112, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  number: { color: colors.text, fontSize: 100, lineHeight: 112, fontWeight: '700', letterSpacing: -3, fontVariant: ['tabular-nums'] },
  // Beside the value, on its baseline: underneath it read as a caption, and
  // people reported not seeing the unit at all.
  numberRow: { width: '100%', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6 },
  numberValue: { flexShrink: 1, minWidth: 0 },
  numberUnit: { flexShrink: 1, color: colors.muted, fontSize: 30, lineHeight: 37, fontWeight: '700' },
  measureRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 16 },
  measureLabel: { ...typeScale.label, flexShrink: 1, color: colors.text, fontWeight: '600' },
  measureControls: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  measureValueBox: { minWidth: 96, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  measureValue: { color: colors.text, fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  measureUnit: { ...typeScale.callout, marginLeft: 4, color: colors.muted, fontWeight: '600' },
  roundButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: radii.pill, backgroundColor: colors.neutralSoft },
  segmentOption: { flex: 1, minHeight: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentOptionActive: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  segmentLabel: { ...typeScale.subhead, color: colors.muted, fontWeight: '600', textAlign: 'center' },
  segmentLabelActive: { color: colors.text, fontWeight: '700' },
  sectionLabel: { ...typeScale.footnote, color: colors.muted, fontWeight: '700', letterSpacing: 0.2 },
  section: { gap: 10 },
  fieldHint: { ...typeScale.footnote, color: colors.muted },
  smallInput: { minHeight: 56, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontSize: 17, fontWeight: '600', paddingHorizontal: 16 },
  ageConfirmRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 4 },
  addGoal: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accentText, backgroundColor: colors.surface },
  addGoalText: { ...typeScale.label, color: colors.accentText, fontWeight: '700' },
  goalMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  goalDiff: { ...typeScale.footnote, color: colors.accentText, fontWeight: '700' },
  linkText: { ...typeScale.footnote, color: colors.muted, fontWeight: '600', textDecorationLine: 'underline' },
  dateChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dateChip: { minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, justifyContent: 'center' },
  dateChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  dateChipText: { ...typeScale.subhead, color: colors.text, fontWeight: '600' },
  dateChipTextActive: { color: colors.onAccent, fontWeight: '700' },
  rateCard: { flex: 1, minHeight: 92, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14, gap: 4 },
  rateCardActive: { borderColor: colors.accentText, backgroundColor: colors.neutralSoft },
  rateRow: { flexDirection: 'row', gap: 10 },
  rateValue: { ...typeScale.callout, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rateDetail: { ...typeScale.caption, color: colors.muted },
  macroRow: { width: '100%', flexDirection: 'row', gap: 8 },
  macroTile: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 16, backgroundColor: colors.neutralSoft },
  macroDot: { width: 8, height: 8, borderRadius: 4 },
  macroValue: { color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  macroLabel: { ...typeScale.caption, color: colors.muted, fontWeight: '600' },
  pacePill: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radii.pill, backgroundColor: colors.accentSoft, paddingHorizontal: 12, paddingVertical: 6 },
  pacePillText: { ...typeScale.footnote, color: colors.accentText, fontWeight: '700' },
  goalCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radii.card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 16 },
  goalIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  adjustHint: { ...typeScale.footnote, color: colors.muted, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { minHeight: 52, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typeScale.callout, color: colors.text, fontWeight: '600' },
  buildingCard: { alignItems: 'center', gap: spacing.md },
  buildingStage: { minHeight: 340, justifyContent: 'center' },
  orbit: { width: 100, height: 100, borderRadius: 50, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutralSoft },
  orbitInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  buildingSteps: { alignSelf: 'stretch', marginTop: 16, gap: 9 },
  buildingStep: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  buildingStepHidden: { opacity: 0 },
  buildingStepLabel: { ...typeScale.footnote, flex: 1, color: colors.muted },
  buildingStepValue: { ...typeScale.subhead, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  buildingTitle: { color: colors.text, fontSize: 20, lineHeight: 25, fontWeight: '700', textAlign: 'center' },
  buildingText: { ...typeScale.subhead, color: colors.muted, textAlign: 'center' },
  startingCard: { borderRadius: radii.card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 24, alignItems: 'center' },
  cardEyebrow: { ...typeScale.caption, color: colors.muted, fontWeight: '800', letterSpacing: 1.3 },
  calories: { color: colors.text, fontSize: 56, lineHeight: 64, fontWeight: '700', letterSpacing: -2, marginTop: 8, fontVariant: ['tabular-nums'] },
  caloriesLabel: { ...typeScale.subhead, color: colors.muted },
  divider: { width: '100%', height: 1, backgroundColor: colors.border, marginVertical: 22 },
  planStats: { width: '100%', flexDirection: 'row' },
  planStat: { flex: 1, minWidth: 0, paddingHorizontal: 4, alignItems: 'center', gap: 5 },
  planStatValue: { ...typeScale.subhead, minHeight: 38, color: colors.text, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  planStatLabel: { ...typeScale.caption, color: colors.muted, textAlign: 'center' },
  adaptsRow: { marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.neutralSoft, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 9 },
  adaptsText: { ...typeScale.caption, flex: 1, color: colors.accentText, fontWeight: '700' },
  limitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16, backgroundColor: colors.attentionSoft, borderRadius: 14, padding: 11 },
  limitText: { ...typeScale.caption, flex: 1, color: colors.text },
  safetyText: { ...typeScale.caption, color: colors.muted, textAlign: 'center', marginTop: 14, opacity: 0.85 },
  modalScrim: { flex: 1, backgroundColor: 'rgba(20,21,15,0.42)', justifyContent: 'flex-end' },
  numberEditorScrim: { flex: 1, backgroundColor: 'rgba(20,21,15,0.42)', justifyContent: 'center', padding: 24 },
  numberEditor: { backgroundColor: colors.surface, borderRadius: radii.card, padding: 20, gap: 14 },
  numberEditorTitle: { color: colors.text, fontSize: 20, lineHeight: 25, fontWeight: '700' },
  consentSheet: { maxHeight: '100%', flexShrink: 1, overflow: 'hidden', borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, backgroundColor: colors.surface },
  consentContent: { paddingHorizontal: 22, paddingTop: 24, gap: 14 },
  consentIcon: { width: 50, height: 50, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  consentTitle: { color: colors.text, fontSize: 25, lineHeight: 30, fontWeight: '700' },
  consentText: { ...typeScale.footnote, color: colors.muted },
  guardianInput: { minHeight: 52, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, fontSize: 16, paddingHorizontal: 15 },
  consentLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  consentLink: { ...typeScale.caption, color: colors.accentText, fontWeight: '800', textDecorationLine: 'underline' },
  consentError: { ...typeScale.footnote, color: colors.attentionText },
  teenRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 16, backgroundColor: colors.neutralSoft, borderRadius: 14, padding: 11 },
  teenText: { ...typeScale.caption, flex: 1, color: colors.text },
  noticeText: { ...typeScale.footnote, flex: 1, color: colors.text },
  analyticsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingHorizontal: 14, paddingVertical: 10 },
  analyticsText: { ...typeScale.footnote, flex: 1, color: colors.text },
  yearBox: { height: 240, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  yearRow: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  yearRowActive: { backgroundColor: colors.neutralSoft },
  yearText: { color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  yearTextActive: { color: colors.accentText, fontWeight: '800' },
  blockContent: { flex: 1, justifyContent: 'center', gap: 14 },
  blockIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
});

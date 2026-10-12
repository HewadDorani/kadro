import { usePresentationBlock } from '@/services/presentation';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, Text, View } from 'react-native';
import { Card, PrimaryButton } from '@/components/ui';
import { useTheme } from '@/context/ThemeContext';
import { useAccess } from '@/context/AccessContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { selectionHaptic } from '@/services/haptics';
import { getReminderPermission, getReminderSettings, MEAL_SLOTS, reminderSlots, updateReminder, type MealSlot, type ReminderOnboardingChoice, type ReminderPermission, type ReminderSettings, type SlotSetting } from '@/services/reminders';
import { typeScale } from '@/constants/theme';

const STEP_MINUTES = 15;
const pad = (value: number) => String(value).padStart(2, '0');

/** Shift by whole quarter hours and wrap around midnight. */
function shift(slot: SlotSetting, minutes: number): SlotSetting {
  const total = ((slot.hour * 60 + slot.minute + minutes) % 1440 + 1440) % 1440;
  const snapped = Math.round(total / STEP_MINUTES) * STEP_MINUTES % 1440;
  return { ...slot, hour: Math.floor(snapped / 60), minute: snapped % 60 };
}

/**
 * Meal reminders are chosen by tapping, not by typing "20:30" into a text
 * field. Each meal has a sensible default time that can be nudged in 15-minute
 * steps. Nothing is scheduled and no OS prompt appears until the user saves.
 */
export function ReminderPreferences({ onDone, initialSetup = false }: { onDone?: (choice: ReminderOnboardingChoice) => void; initialSetup?: boolean }) {
  const { colors } = useTheme();
  const access = useAccess();
  const { t } = useLanguage();
  const copy = t.captureExtras;
  const labels: Record<MealSlot, string> = { breakfast: copy.slotBreakfast, lunch: copy.slotLunch, dinner: copy.slotDinner, evening: copy.slotEvening };
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [slots, setSlots] = useState<Record<MealSlot, SlotSetting> | null>(null);
  const [singleSelection, setSingleSelection] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<ReminderPermission>('unavailable');
  const [busy, setBusy] = useState(false);
  usePresentationBlock(busy);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => { void Promise.all([getReminderSettings(), getReminderPermission()]).then(([value, status]) => {
      if (!active) return;
      setSettings(value); setPermission(status);
      const defaults = reminderSlots(value);
      // First onboarding offers one daily time. Preserve explicitly saved
      // multiple choices; the later trial/profile routine remains unrestricted.
      const savedMultiple = value.mode === 'meals' && MEAL_SLOTS.filter(slot => defaults[slot].enabled).length > 1;
      const limited = initialSetup && !savedMultiple;
      setSingleSelection(current => current ?? limited);
      setSlots(current => current ?? (limited && !value.enabled && value.mode !== 'meals'
        ? { ...defaults, lunch: { ...defaults.lunch, enabled: false } }
        : defaults));
    }).catch(() => { if (active) setError(copy.reminderError); }); };
    refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { active = false; subscription.remove(); };
  }, [copy.reminderError, initialSetup]);

  const update = (slot: MealSlot, next: SlotSetting) => {
    void selectionHaptic();
    setError(null);
    setSlots(current => {
      if (!current) return current;
      const updated = { ...current, [slot]: next };
      if (singleSelection && next.enabled) {
        for (const other of MEAL_SLOTS) {
          if (other !== slot) updated[other] = { ...current[other], enabled: false };
        }
      }
      return updated;
    });
  };
  const apply = async (enabled: boolean) => {
    if (busy || !settings || !slots) return;
    if (enabled && !MEAL_SLOTS.some(slot => slots[slot].enabled)) { setError(copy.chooseOne); return; }
    setBusy(true); setError(null);
    try {
      const first = MEAL_SLOTS.find(slot => slots[slot].enabled) ?? 'dinner';
      const next: ReminderSettings = { enabled, mode: 'meals', slots, hour: slots[first].hour, minute: slots[first].minute };
      const result = await updateReminder(next);
      setPermission(result.permission); setSettings({ ...next, enabled: result.enabled });
      if (result.permission === 'unavailable' || result.permission === 'error') setError(copy.reminderError);
      else if (result.enabled) onDone?.('enabled');
    } catch { setError(copy.reminderError); }
    finally { setBusy(false); }
  };

  // First setup is a full onboarding page (icon, headline, one line of value);
  // in settings the same controls sit in a regular card.
  const Wrapper = initialSetup ? View : Card;
  return <Wrapper style={initialSetup ? { gap: 14, paddingTop: 12 } : undefined}>
    {initialSetup ? <View style={{ width: 56, height: 56, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
      <Ionicons color={colors.onAccent} name="notifications" size={26} />
    </View> : null}
    <Text accessibilityRole="header" style={initialSetup ? { color: colors.text, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -1 } : { ...typeScale.title2, color: colors.text, fontWeight: '700' }}>{initialSetup ? copy.reminderAskTitle : copy.reminderTitle}</Text>
    <Text style={{ ...typeScale.body, color: colors.muted }}>{singleSelection ? copy.reminderSingleText : copy.reminderText}</Text>
    {access.ready && !access.canUse && !onDone ? <Text style={{ ...typeScale.body, color: colors.muted }}>{t.access.pausedReminder}</Text> : null}
    {slots ? <View style={{ gap: 10, marginTop: 8 }}>
      {MEAL_SLOTS.map(slot => {
        const value = slots[slot];
        const time = `${pad(value.hour)}:${pad(value.minute)}`;
        // Time nudges sit inline beside the time: one row per meal.
        const stepButton = (minutes: number, label: string, icon: 'remove' | 'add') => (
          <Pressable accessibilityRole="button" accessibilityLabel={`${labels[slot]}: ${label}`} disabled={busy} hitSlop={6} onPress={() => update(slot, shift(value, minutes))} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutralSoft, opacity: pressed ? 0.6 : 1 })}>
            <Ionicons color={colors.text} name={icon} size={18} />
          </Pressable>
        );
        return <View key={slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 64, borderWidth: 1, borderColor: value.enabled ? colors.accentText : colors.border, backgroundColor: value.enabled ? colors.accentSoft : colors.surface, borderRadius: 18, paddingHorizontal: 14 }}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: value.enabled, disabled: busy }}
            accessibilityLabel={`${labels[slot]}, ${time}`}
            disabled={busy}
            onPress={() => update(slot, { ...value, enabled: !value.enabled })}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56 }}
          >
            <Ionicons color={value.enabled ? colors.accentText : colors.muted} name={value.enabled ? 'checkmark-circle' : 'ellipse-outline'} size={24} />
            <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={{ ...typeScale.label, flex: 1, color: colors.text, fontWeight: '600' }}>{labels[slot]}</Text>
            {!value.enabled ? <Text style={{ ...typeScale.label, color: colors.muted, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{time}</Text> : null}
          </Pressable>
          {value.enabled ? <>
            {stepButton(-STEP_MINUTES, copy.earlier, 'remove')}
            <Text accessibilityLiveRegion="polite" style={{ minWidth: 56, textAlign: 'center', color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{time}</Text>
            {stepButton(STEP_MINUTES, copy.later, 'add')}
          </> : null}
        </View>;
      })}
    </View> : null}
    {permission === 'quiet' ? <Text style={{ color: colors.muted }}>{copy.quiet}</Text> : null}
    {permission === 'denied' ? <View><Text style={{ color: colors.muted }}>{copy.permissionDenied}</Text><PrimaryButton label={copy.settings} variant="ghost" onPress={() => void Linking.openSettings().catch(() => setError(copy.reminderError))} /></View> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.attentionText }}>{error}</Text> : null}
    <PrimaryButton disabled={busy || !settings || !slots || permission === 'unavailable'} label={busy ? t.common.moment : initialSetup ? copy.reminderAskYes : settings?.enabled ? copy.save : copy.activate} onPress={() => void apply(true)} />
    {settings?.enabled ? <PrimaryButton disabled={busy} variant="ghost" label={copy.disable} onPress={() => void apply(false)} /> : null}
    {onDone ? <PrimaryButton disabled={busy} variant="ghost" label={initialSetup ? copy.reminderAskLater : copy.skip} onPress={() => onDone('skipped')} /> : null}
  </Wrapper>;
}

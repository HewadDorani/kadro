import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop } from 'react-native-svg';
import { radii, typeScale } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { normalizePersonalGoal } from '@/services/personalGoal';
import type { UserProfile } from '@/types/nutrition';
import { formatWeight } from '@/utils/units';
import { formatDateParts } from '@/utils/format';
import { localDateKey } from '@/utils/date';

const CHART_HEIGHT = 120;
const PAD = 14;

/** Weeks at the chosen planning rate; the same arithmetic as the onboarding pace chip. */
export function projectionWeeks(currentKg: number, targetKg: number, weeklyRateKg: number) {
  if (!(weeklyRateKg > 0)) return null;
  const diff = Math.abs(targetKg - currentKg);
  if (diff < 0.1) return null;
  return Math.min(104, Math.max(1, Math.ceil(diff / weeklyRateKg)));
}

/**
 * A user-entered adult wish, separate from the calculated nutrition plan,
 * drawn as the path from today's weight to the wish. The curve is an
 * illustration of the chosen pace, explicitly not a prediction.
 */
export function PersonalGoalSummary({ profile }: { profile: UserProfile }) {
  const { colors } = useTheme();
  const { t, locale } = useLanguage();
  const [width, setWidth] = useState(0);
  const goal = normalizePersonalGoal(profile);
  if (goal.targetWeightKg === null) return null;
  const target = goal.targetWeightKg;
  const weight = formatWeight(target, profile.unitSystem, locale);
  const weeks = projectionWeeks(profile.weightKg, target, profile.weeklyRateKg);
  const endIso = goal.targetDate ?? (weeks ? addDays(localDateKey(), weeks * 7) : null);
  const short = (iso: string) => formatDateParts(new Date(`${iso}T12:00:00`), { day: 'numeric', month: 'short' }, locale);
  const date = goal.targetDate ? formatDateParts(new Date(`${goal.targetDate}T12:00:00`), { day: 'numeric', month: 'short', year: 'numeric' }, locale) : null;

  // Geometry: start high-left for losing, low-left for gaining; an eased curve
  // that flattens towards the goal, the way a sustainable change looks.
  const losing = target < profile.weightKg;
  const w = Math.max(0, width - PAD * 2);
  const top = PAD + 6;
  const bottom = CHART_HEIGHT - PAD - 6;
  const startY = losing ? top : bottom;
  const endY = losing ? bottom : top;
  const startX = PAD;
  const endX = PAD + w;
  const curve = `M ${startX} ${startY} C ${startX + w * 0.35} ${startY + (endY - startY) * 0.75}, ${startX + w * 0.65} ${endY}, ${endX} ${endY}`;
  const area = `${curve} L ${endX} ${CHART_HEIGHT} L ${startX} ${CHART_HEIGHT} Z`;

  return <View style={{ alignSelf: 'stretch', borderRadius: radii.card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons color={colors.onAccent} name="flag" size={18} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ ...typeScale.caption, color: colors.muted, fontWeight: '700' }}>{t.onboarding.personalGoalTitle}</Text>
        <Text style={{ ...typeScale.headline, color: colors.text, fontWeight: '700' }}>{date ? t.onboarding.goalBy(weight, date) : weight}</Text>
      </View>
    </View>
    {endIso ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: CHART_HEIGHT }}>
      {width > 0 ? <Svg height={CHART_HEIGHT} width={width}>
        <Defs>
          <LinearGradient id="goalFill" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor={colors.accent} stopOpacity={0.45} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Line stroke={colors.border} strokeDasharray="4 5" strokeWidth={1} x1={startX} x2={endX} y1={endY} y2={endY} />
        <Path d={area} fill="url(#goalFill)" />
        <Path d={curve} fill="none" stroke={colors.accentText} strokeLinecap="round" strokeWidth={3} />
        <Circle cx={startX} cy={startY} fill={colors.surface} r={5} stroke={colors.accentText} strokeWidth={2.5} />
        <Circle cx={endX} cy={endY} fill={colors.accentText} r={6} />
      </Svg> : null}
    </View> : null}
    {endIso ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ ...typeScale.caption, color: colors.muted, fontWeight: '600' }}>{t.onboarding.projectionToday} · {formatWeight(profile.weightKg, profile.unitSystem, locale)}</Text>
      <Text style={{ ...typeScale.caption, color: colors.text, fontWeight: '700' }}>{short(endIso)} · {weight}</Text>
    </View> : null}
    <Text style={{ ...typeScale.caption, color: colors.muted }}>{t.onboarding.personalGoalDisclaimer}</Text>
  </View>;
}

function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

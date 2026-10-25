import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { FavoriteLogSheet } from '@/components/FavoriteLogSheet';
import { radii, typeScale } from '@/constants/theme';
import type { ThemeColors } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { mealTypeLabel } from '@/utils/format';
import { mealTypeForTime } from '@/utils/mealDay';

/**
 * "Favoriten" on the scan screen, beside Foto / Beschreiben / Barcode /
 * Suchen. A button above the mode bar rather than a fifth chip: five chips
 * wrapped the bar onto two lines on most iPhones in German.
 */
export function ScanFavoritesButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  const { favoriteMeals, plannedMealType } = useApp();
  return (
    <Pressable
      accessibilityHint={t.favorites.pickHint}
      accessibilityLabel={plannedMealType ? t.favorites.pickTitleFor(mealTypeLabel(plannedMealType, t.common)) : t.favorites.modeChip}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons color={colors.accent} name="star" size={16} />
      <Text numberOfLines={1} style={styles.text}>{t.favorites.modeChip}</Text>
      {favoriteMeals.length ? <Text style={styles.count}>{favoriteMeals.length}</Text> : null}
    </Pressable>
  );
}

/**
 * One tap on a favourite, check the portion, and it is saved into the slot
 * and day this scan was opened for (Today's "+ Abendessen" and the day
 * switcher, via plannedMealType / plannedMealDate); without a stated slot the
 * user picks one, preselected by the clock.
 */
export function ScanFavoritesSheet({ visible, onClose, onLogged }: { visible: boolean; onClose: () => void; onLogged: () => void }) {
  const { plannedMealDate, plannedMealType } = useApp();
  return (
    <FavoriteLogSheet
      date={plannedMealDate}
      defaultSlot={plannedMealType ?? mealTypeForTime()}
      fixedSlot={plannedMealType}
      onClose={onClose}
      onLogged={onLogged}
      visible={visible}
    />
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  button: { minHeight: 44, maxWidth: '100%', borderRadius: radii.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', backgroundColor: 'rgba(17,19,15,0.58)', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pressed: { backgroundColor: 'rgba(17,19,15,0.78)' },
  text: { ...typeScale.footnote, flexShrink: 1, color: colors.white, fontWeight: '700' },
  count: { ...typeScale.caption, minWidth: 22, borderRadius: radii.pill, overflow: 'hidden', backgroundColor: colors.accent, color: colors.onAccent, fontWeight: '800', textAlign: 'center', paddingHorizontal: 6, fontVariant: ['tabular-nums'] },
});

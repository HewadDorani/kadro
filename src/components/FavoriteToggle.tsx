import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, typeScale } from '@/constants/theme';
import type { ThemeColors } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { errorHaptic, selectionHaptic, successHaptic } from '@/services/haptics';

/**
 * "Zu Favoriten hinzufügen" on Confirm and Result: one clear row with a star,
 * not an unlabelled icon. It stores the current meal exactly as it is saved
 * (items and grams); on Confirm the save fulfils it.
 */
export function FavoriteToggle({ onToast }: { onToast: (message: string) => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  const { scanFavorite, setScanFavorite } = useApp();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const next = !scanFavorite;
    setBusy(true);
    void (next ? successHaptic() : selectionHaptic());
    try {
      await setScanFavorite(next);
      onToast(next ? t.favorites.toastAdded : t.favorites.toastRemoved);
    } catch (error) {
      void errorHaptic();
      onToast(error instanceof Error && error.message === 'favorite_limit_reached' ? t.favorites.limitReached : t.favorites.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      accessibilityHint={t.favorites.addHint}
      accessibilityLabel={t.favorites.add}
      accessibilityRole="switch"
      accessibilityState={{ checked: scanFavorite, disabled: busy }}
      disabled={busy}
      onPress={() => void toggle()}
      style={({ pressed }) => [styles.row, scanFavorite && styles.rowOn, pressed && styles.rowPressed]}
    >
      <View style={[styles.star, scanFavorite && styles.starOn]}>
        <Ionicons color={scanFavorite ? colors.onAccent : colors.text} name={scanFavorite ? 'star' : 'star-outline'} size={18} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.label}>{scanFavorite ? t.favorites.added : t.favorites.add}</Text>
        <Text style={styles.hint}>{t.favorites.addHint}</Text>
      </View>
      <Ionicons color={scanFavorite ? colors.accentText : colors.muted} name={scanFavorite ? 'checkmark-circle' : 'add-circle-outline'} size={22} />
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { minHeight: 64, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowOn: { borderColor: colors.accent },
  rowPressed: { backgroundColor: colors.neutralSoft },
  star: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  starOn: { backgroundColor: colors.accent },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { ...typeScale.label, color: colors.text, fontWeight: '700' },
  hint: { ...typeScale.footnote, color: colors.muted },
});

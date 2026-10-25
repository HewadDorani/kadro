import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ThemeColors } from '@/constants/theme';
import { typeScale } from '@/constants/theme';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';

/**
 * Title row of a bottom sheet with a close button top right, where people
 * look for it. The X replaces a "Cancel" button at the bottom, which sat under
 * the keyboard or pushed results out of view.
 */
export function SheetHeader({ title, onClose, accessory, size = 'large', closeLabel }: {
  title: string;
  onClose: () => void;
  accessory?: ReactNode;
  size?: 'large' | 'medium';
  closeLabel?: string;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" numberOfLines={2} style={[styles.title, size === 'medium' && styles.titleMedium]}>{title}</Text>
      {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      <Pressable
        accessibilityLabel={closeLabel ?? t.common.close}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onClose}
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <Ionicons color={colors.text} name="close" size={20} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { ...typeScale.title1, flex: 1, minWidth: 0, color: colors.text, fontWeight: '700' },
  titleMedium: { ...typeScale.title2 },
  accessory: { flexShrink: 0 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutralSoft },
  pressed: { opacity: 0.7 },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, ListDivider, SettingsRow } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { typeScale } from '@/constants/theme';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { MARKET_REGIONS, MarketRegionSetting, useMarketRegionSetting } from '@/services/region';

/**
 * Du → "Land für Vorschläge": which market's products, store brands and
 * supermarkets search, barcode and Plan use. Automatic follows the device
 * region; the choice is stored on this device only.
 */
export function MarketRegionPreference() {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { setting, device, setSetting } = useMarketRegionSetting();
  const copy = t.profile;
  const options: { value: MarketRegionSetting; label: string; detail?: string }[] = [
    { value: 'auto', label: copy.marketRegionAuto, detail: copy.marketRegionAutoDetail(copy.marketRegionNames[device]) },
    ...MARKET_REGIONS.map((region) => ({ value: region, label: copy.marketRegionNames[region] })),
  ];
  return (
    <Card style={styles.card}>
      <SettingsRow detail={copy.marketRegionDetail} icon="storefront-outline" label={copy.marketRegion} />
      <View accessibilityRole="radiogroup" style={styles.options}>
        {options.map((option, index) => {
          const active = option.value === setting;
          return (
            <View key={option.value}>
              {index ? <ListDivider inset={false} /> : null}
              <Pressable
                accessibilityLabel={option.detail ? `${option.label}, ${option.detail}` : option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                aria-checked={active}
                onPress={() => void setSetting(option.value)}
                style={styles.option}
              >
                <View style={styles.copy}>
                  <Text style={styles.label}>{option.label}</Text>
                  {option.detail ? <Text style={styles.detail}>{option.detail}</Text> : null}
                </View>
                <Ionicons
                  color={active ? colors.text : colors.muted}
                  name={active ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                />
              </Pressable>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: { padding: 8 },
  options: { paddingHorizontal: 4 },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 10 },
  copy: { flex: 1, gap: 2 },
  label: { ...typeScale.callout, color: colors.text, fontWeight: '600' },
  detail: { ...typeScale.footnote, color: colors.muted },
});

import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageProvider';
import type { LegalCopy } from '@/i18n/legal.de';
import { radii, typeScale } from '@/constants/theme';

export function LegalDocument({ document, version }: { document: LegalCopy; version: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { title, intro, sections } = document;
  const router = useRouter();
  const { t } = useLanguage();
  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel={t.common.back} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Ionicons color={colors.text} name="arrow-back" size={22} />
        </Pressable>
        <Text style={styles.topTitle}>{t.common.legalHeading}</Text>
        <View style={styles.backButton} />
      </View>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.version}>{t.common.versionPrefix} {version}</Text>
        <Text style={styles.intro}>{intro}</Text>
      </View>
      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>
          {section.paragraphs.map((paragraph) => <Text key={paragraph} style={styles.paragraph}>{paragraph}</Text>)}
        </View>
      ))}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '700' },
  heading: { gap: 9 },
  title: { color: colors.text, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.8 },
  version: { ...typeScale.caption, color: colors.muted },
  intro: { ...typeScale.callout, color: colors.text, marginTop: 5 },
  section: { borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 20, gap: 10 },
  sectionTitle: { color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: '700' },
  paragraph: { ...typeScale.footnote, color: colors.muted },
});

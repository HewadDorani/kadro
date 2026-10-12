import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Card, PrimaryButton, SectionTitle } from '@/components/ui';
import { MealDetailSheet } from '@/components/MealDetailSheet';
import { useAccess } from '@/context/AccessContext';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { withFavorites } from '@/services/repeatMeals';
import { formatNumber } from '@/utils/format';
import { typeScale } from '@/constants/theme';

/**
 * Favourites first ("Alle Favoriten" on Today), then every saved meal.
 * Existing owner data stays editable after access expires; logging a
 * favourite again is a new entry and is only offered while access allows it.
 */
export default function SavedMeals() {
  const { favoriteMeals, logRepeatMeal, mealHistory, toggleFavoriteMeal, wellnessConsentGranted } = useApp();
  const { canUse } = useAccess();
  const { locale, t } = useLanguage(); const { colors } = useTheme(); const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logged, setLogged] = useState<string[]>([]);
  const favorites = useMemo(() => withFavorites([], favoriteMeals, mealHistory, favoriteMeals.length), [favoriteMeals, mealHistory]);
  const canLog = canUse && wellnessConsentGranted;

  const logAgain = async (key: string) => {
    const candidate = favorites.find(entry => entry.key === key);
    if (!candidate || busy) return;
    setBusy(key);
    try {
      await logRepeatMeal(candidate);
      setLogged(list => [...list, key]);
    } catch {
      Alert.alert(t.result.saveFailed);
    } finally {
      setBusy(null);
    }
  };

  return <Screen>
    <PrimaryButton variant="ghost" label={t.common.back} onPress={() => router.canGoBack() ? router.back() : router.replace('/account-help' as never)} />
    <Text accessibilityRole="header" style={{ ...typeScale.title1, color: colors.text, fontWeight: '700' }}>{t.access.favoritesTitle}</Text>
    {!favorites.length ? <Text style={{ ...typeScale.subhead, color: colors.muted }}>{t.access.favoritesEmpty}</Text> : null}
    {favorites.map(candidate => (
      <Card key={candidate.key} style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text numberOfLines={2} style={{ ...typeScale.headline, color: colors.text, fontWeight: '600' }}>{candidate.title}</Text>
            <Text style={{ ...typeScale.footnote, color: colors.muted }}>~{formatNumber(candidate.calories, locale)} kcal · {candidate.protein} g {t.common.protein}</Text>
          </View>
          <Pressable
            accessibilityLabel={t.mealSheet.favoriteRemove}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => void toggleFavoriteMeal(candidate.source)}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons color={colors.onAccent} name="star" size={19} />
          </Pressable>
        </View>
        {canLog ? (
          <PrimaryButton
            disabled={busy !== null || logged.includes(candidate.key)}
            icon={logged.includes(candidate.key) ? 'checkmark' : 'refresh'}
            label={logged.includes(candidate.key) ? t.access.loggedAgain : t.access.logAgain}
            onPress={() => void logAgain(candidate.key)}
            variant="secondary"
          />
        ) : null}
      </Card>
    ))}

    <SectionTitle>{t.access.allSavedMeals}</SectionTitle>
    {!mealHistory.length ? <Text style={{ color: colors.muted }}>{t.access.emptyHistory}</Text> : null}
    {mealHistory.map(meal => <Pressable key={meal.id} accessibilityRole="button" accessibilityHint={t.common.mealHint} onPress={() => setSelected(meal.id)}>
      <Card><Text style={{ ...typeScale.headline, color: colors.text, fontWeight: '600' }}>{meal.title}</Text><Text style={{ color: colors.muted }}>{meal.date}</Text></Card>
    </Pressable>)}
    <MealDetailSheet meal={mealHistory.find(meal => meal.id === selected) ?? null} onClose={() => setSelected(null)} />
  </Screen>;
}

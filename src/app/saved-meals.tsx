import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Card, PrimaryButton, SectionTitle } from '@/components/ui';
import { FavoriteLogSheet } from '@/components/FavoriteLogSheet';
import { MealDetailSheet } from '@/components/MealDetailSheet';
import { useToast } from '@/components/Toast';
import { useAccess } from '@/context/AccessContext';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { errorHaptic, selectionHaptic, successHaptic } from '@/services/haptics';
import { favoriteCandidate, RepeatCandidate } from '@/services/repeatMeals';
import { mealTypeForHour } from '@/utils/daypart';
import { formatNumber, mealTypeLabel } from '@/utils/format';
import { radii, typeScale } from '@/constants/theme';

/**
 * "Alle Favoriten" (from Today), then every saved meal.
 * Favourites can be logged into a chosen slot, renamed and removed. Existing
 * owner data stays editable after access expires; logging a favourite again
 * is a new entry and is only offered while access allows it.
 */
export default function SavedMeals() {
  const { favoriteMeals, mealHistory, removeFavoriteMeal, renameFavoriteMeal, wellnessConsentGranted } = useApp();
  const { canUse } = useAccess();
  const { locale, t } = useLanguage(); const { colors } = useTheme(); const router = useRouter();
  const { toast, show: showToast } = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [logging, setLogging] = useState<RepeatCandidate | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const favorites = useMemo(() => favoriteMeals.map(entry => ({ entry, candidate: favoriteCandidate(entry, mealHistory) })), [favoriteMeals, mealHistory]);
  const canLog = canUse && wellnessConsentGranted;

  const remove = async (id: string | undefined) => {
    if (!id || busy) return;
    setBusy(true);
    void selectionHaptic();
    try {
      await removeFavoriteMeal(id);
      showToast(t.favorites.toastRemoved);
    } catch {
      void errorHaptic();
      showToast(t.favorites.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    if (!renaming || busy) return;
    if (!renaming.title.trim()) { setRenameError(t.favorites.nameEmpty); return; }
    setBusy(true);
    try {
      await renameFavoriteMeal(renaming.id, renaming.title);
      void successHaptic();
      setRenaming(null);
      setRenameError(null);
      showToast(t.favorites.toastRenamed);
    } catch (error) {
      void errorHaptic();
      setRenameError(error instanceof Error && error.message === 'favorite_name_taken' ? t.favorites.nameTaken : t.favorites.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return <Screen overlay={toast}>
    <PrimaryButton variant="ghost" label={t.common.back} onPress={() => router.canGoBack() ? router.back() : router.replace('/account-help' as never)} />
    <Text accessibilityRole="header" style={{ ...typeScale.title1, color: colors.text, fontWeight: '700' }}>{t.access.favoritesTitle}</Text>
    {!favorites.length ? (
      <Card style={{ gap: 10 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons color={colors.text} name="star-outline" size={22} />
        </View>
        <Text style={{ ...typeScale.headline, color: colors.text, fontWeight: '700' }}>{t.favorites.emptyTitle}</Text>
        <Text style={{ ...typeScale.subhead, color: colors.muted }}>{t.access.favoritesEmpty}</Text>
      </Card>
    ) : null}
    {favorites.map(({ entry, candidate }) => {
      const editing = renaming?.id === entry.id;
      return (
        <Card key={candidate.key} style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons accessibilityLabel={t.today.favoriteLabel} color={colors.onAccent} name="star" size={15} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text numberOfLines={2} style={{ ...typeScale.headline, color: colors.text, fontWeight: '600' }}>{candidate.title}</Text>
              <Text style={{ ...typeScale.footnote, color: colors.muted }}>
                ~{formatNumber(candidate.calories, locale)} kcal · {candidate.protein} g {t.common.protein} · {t.favorites.itemCount(candidate.source.items.filter(item => item.included).length)}
              </Text>
            </View>
          </View>
          {editing ? (
            <View style={{ gap: 8 }}>
              <TextInput
                accessibilityLabel={t.favorites.renameLabel}
                autoFocus
                maxLength={160}
                onChangeText={title => { setRenaming({ id: entry.id!, title }); setRenameError(null); }}
                onSubmitEditing={() => void saveName()}
                placeholder={t.favorites.renameLabel}
                placeholderTextColor={colors.muted}
                returnKeyType="done"
                style={{ minHeight: 48, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, fontSize: 16, paddingHorizontal: 14 }}
                value={renaming?.title ?? ''}
              />
              {renameError ? <Text accessibilityRole="alert" style={{ ...typeScale.footnote, color: colors.attentionText }}>{renameError}</Text> : null}
              <PrimaryButton disabled={busy} icon="checkmark" label={t.favorites.renameSave} onPress={() => void saveName()} variant="secondary" />
              <PrimaryButton label={t.common.cancel} onPress={() => { setRenaming(null); setRenameError(null); }} variant="ghost" />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Pressable
                accessibilityLabel={t.favorites.renameItemLabel(candidate.title)}
                accessibilityRole="button"
                disabled={busy || !entry.id}
                onPress={() => entry.id && setRenaming({ id: entry.id, title: candidate.title })}
                style={{ minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Ionicons color={colors.text} name="pencil" size={15} />
                <Text style={{ ...typeScale.footnote, color: colors.text, fontWeight: '600' }}>{t.favorites.rename}</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={t.favorites.removeLabel(candidate.title)}
                accessibilityRole="button"
                disabled={busy || !entry.id}
                onPress={() => void remove(entry.id)}
                style={{ minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Ionicons color={colors.text} name="star-outline" size={15} />
                <Text style={{ ...typeScale.footnote, color: colors.text, fontWeight: '600' }}>{t.favorites.remove}</Text>
              </Pressable>
            </View>
          )}
          {canLog && !editing ? (
            <PrimaryButton
              disabled={busy}
              icon="add"
              label={t.access.logAgain}
              onPress={() => setLogging(candidate)}
              variant="secondary"
            />
          ) : null}
        </Card>
      );
    })}

    <SectionTitle>{t.access.allSavedMeals}</SectionTitle>
    {!mealHistory.length ? <Text style={{ ...typeScale.subhead, color: colors.muted }}>{t.access.emptyHistory}</Text> : null}
    {mealHistory.map(meal => <Pressable key={meal.id} accessibilityRole="button" accessibilityHint={t.common.mealHint} onPress={() => setSelected(meal.id)}>
      <Card style={{ gap: 2 }}><Text style={{ ...typeScale.headline, color: colors.text, fontWeight: '600' }}>{meal.title}</Text><Text style={{ ...typeScale.footnote, color: colors.muted, fontVariant: ['tabular-nums'] }}>{meal.date}</Text></Card>
    </Pressable>)}
    <MealDetailSheet meal={mealHistory.find(meal => meal.id === selected) ?? null} onClose={() => setSelected(null)} />
    <FavoriteLogSheet
      candidate={logging}
      date={null}
      defaultSlot={mealTypeForHour(new Date().getHours())}
      onClose={() => setLogging(null)}
      onLogged={(_meal, slot) => { setLogging(null); showToast(t.favorites.loggedAs(mealTypeLabel(slot, t.common))); }}
      visible={logging !== null}
    />
  </Screen>;
}

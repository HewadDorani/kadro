import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import type { ThemeColors } from '@/constants/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { mealPhotoPlaceholder } from '@/utils/format';
import { PortionSheet } from '@/components/PortionSheet';
import { Card, ConfidenceBadge, MealPhoto, PrimaryButton, Screen } from '@/components/ui';
import { radii, typeScale } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { countBucket, trackEvent } from '@/services/telemetry';
import { useLanguage } from '@/i18n/LanguageProvider';
import { successHaptic } from '@/services/haptics';
import { PortionFactor } from '@/types/nutrition';
import { formatNumber } from '@/utils/format';
import { initialSelection, itemNutritionPer100g } from '@/utils/portions';
import { canSaveMealDraft, needsIngredientCorrection } from '@/utils/ingredientCorrection';
import { FoodSearchResult, searchIngredientReplacement } from '@/services/mealAnalysis';
import { milkCorrectionQuery } from '@/utils/foodCorrectionQuery';
import { MealItem } from '@/types/nutrition';
import { LogTargetRow } from '@/components/LogTargetPicker';
import { FavoriteToggle } from '@/components/FavoriteToggle';
import { useToast } from '@/components/Toast';
import { draftConfidence } from '@/utils/confidence';

export default function ConfirmScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { analysisMessage, autoMatchedItemIds, detectedItems, mealPortion, photoUri, portionEstimated, removeDetectedItem, replaceDetectedItem, scanMode, scannedMeal, scanTarget, setItemAmount, setMealPortion, setPlannedMealDate, setPlannedMealType } = useApp();
  const [amountFor, setAmountFor] = useState<string | null>(null);
  const [preferGrams, setPreferGrams] = useState(false);
  const [removeFor, setRemoveFor] = useState<string | null>(null);
  // A barcode or a search hit is one food, and for one food the honest
  // question is "how many grams", not "0.7x of what we guessed".
  const singleItem = detectedItems.length === 1 ? detectedItems[0] : null;
  const hasIncludedFood = detectedItems.some((item) => item.included);
  const correctionRequired = detectedItems.some(needsIngredientCorrection);
  const canConfirm = canSaveMealDraft(detectedItems);
  const { locale, t } = useLanguage();
  const { toast, show: showToast } = useToast();
  // Estimates are normal and need no disclaimer wall. Only hints the person
  // can act on are shown, each as one short line. The amount hint is folded
  // into the "Portion geschätzt" banner when that is showing.
  const warningLines = analysisMessage?.split('\n\n') ?? [];
  const actionableHints = [
    t.errors.warnUnmatched, t.errors.warnHiddenCalories, t.errors.warnWidePortion,
    t.errors.warnMilkVolume, t.errors.warnDrinkVolume,
    ...(portionEstimated ? [] : [t.errors.warnAmountEstimated]),
  // "Values missing" only while a row is still unresolved, not after Kandro matched it.
  ].filter(line => warningLines.includes(line) && !(line === t.errors.warnUnmatched && !correctionRequired));
  const confidence = draftConfidence(detectedItems, {
    autoMatchedIds: autoMatchedItemIds,
    portionEstimated,
    uncertainHint: warningLines.includes(t.errors.warnWidePortion) || warningLines.includes(t.errors.warnAmountEstimated),
  });
  // The banner opens the amount of the single food, or the first estimated one.
  const firstAdjustable = singleItem ?? detectedItems.find(item => item.included && !needsIngredientCorrection(item)) ?? null;
  const replaceFood = (id: string) => router.push({ pathname: '/correct-food', params: { itemId: id } } as never);

  const changeInput = () => {
    // A supermarket basket came from Plan; going back shows the other two.
    if (scanMode === 'plan') {
      router.back();
      return;
    }
    if (scanMode === 'search') {
      router.dismissTo('/(tabs)/scan?mode=search');
      return;
    }
    if (scanMode === 'description') {
      router.dismissTo('/(tabs)/scan?mode=description');
      return;
    }
    router.dismissTo('/(tabs)/scan');
  };

  const confirm = () => {
    if (!canConfirm) return;
    void successHaptic();
    const includedItems = detectedItems.filter((item) => item.included);
    trackEvent('meal confirmed', {
      confidence: scannedMeal.confidence,
      correction_applied: mealPortion !== 1 || detectedItems.some((item) => !item.included || item.amountG !== item.baseAmountG),
      included_item_count: countBucket(includedItems.length),
    });
    router.replace('/result');
  };

  return (
    <Screen overlay={toast}>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel={t.common.back} accessibilityRole="button" hitSlop={8} onPress={() => router.back()} style={styles.iconButton}>
          <Ionicons color={colors.text} name="arrow-back" size={22} />
        </Pressable>
        <Text style={styles.topTitle}>{t.confirm.title}</Text>
        <View style={styles.iconButtonSpacer} />
      </View>

      {photoUri ? <MealPhoto height={230} placeholder={mealPhotoPlaceholder(scanMode)} uri={photoUri} /> : null}

      <View style={styles.heading}>
        <View style={styles.headingRow}>
          <Text style={styles.title}>{t.confirm.heading}</Text>
          {hasIncludedFood ? <ConfidenceBadge level={confidence} /> : null}
        </View>
        <Text style={styles.subtitle}>{singleItem ? t.confirm.subtitleSingle : t.confirm.subtitle}</Text>
      </View>

      {scanMode !== 'demo' ? (
        <LogTargetRow
          date={scanTarget.date}
          onChange={(type, date) => { setPlannedMealType(type); setPlannedMealDate(date); }}
          type={scanTarget.type}
        />
      ) : null}

      {/* "Amount unclear" is not an error: the typical portion is prefilled
          and one tap opens it. */}
      {portionEstimated && firstAdjustable ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAmountFor(firstAdjustable.id)}
          style={({ pressed }) => [styles.estimateBanner, pressed && { opacity: 0.7 }]}
        >
          <Ionicons color={colors.text} name="contrast" size={18} />
          <Text style={styles.estimateBannerText}>{t.confirm.portionEstimated}</Text>
          <Ionicons color={colors.text} name="create-outline" size={18} />
        </Pressable>
      ) : null}

      {actionableHints.length ? (
        <View style={styles.analysisWarning}>
          {actionableHints.map(line => (
            <View key={line} style={styles.analysisWarningRow}>
              <Ionicons color={colors.accentText} name="information-circle-outline" size={16} />
              <Text style={styles.analysisWarningText}>{line}</Text>
            </View>
          ))}
        </View>
      ) : null}


      {singleItem && !needsIngredientCorrection(singleItem) ? (
        <Card style={styles.portionCard}>
          <View style={styles.portionHeading}>
            <View>
              <Text style={styles.portionTitle}>{t.confirm.amountQuestion}</Text>
              <Text style={styles.portionSubtitle}>{singleItem.name}</Text>
            </View>
            <Ionicons color={colors.accentText} name="resize-outline" size={22} />
          </View>
          <Pressable
            accessibilityLabel={t.confirm.amountQuestion}
            accessibilityRole="button"
            onPress={() => setAmountFor(singleItem.id)}
            style={styles.amountField}
          >
            <Text style={styles.amountFieldValue}>{(() => {
              const selection = initialSelection(singleItem.amountG, singleItem.portions, { chosen: true });
              return selection.unitIndex >= 0 ? `${formatNumber(Number(selection.amount), locale)} × ${singleItem.portions![selection.unitIndex].label}` : `${formatNumber(singleItem.amountG, locale)} g`;
            })()}</Text>
            <Ionicons color={colors.muted} name="create-outline" size={20} />
          </Pressable>
        </Card>
      ) : !singleItem ? (
      <Card style={styles.portionCard}>
        <View style={styles.portionHeading}>
          <View>
            <Text style={styles.portionTitle}>{t.confirm.portionQuestion}</Text>
            <Text style={styles.portionSubtitle}>{mealPortion ? t.confirm.portionQuick : t.confirm.portionCustom}</Text>
          </View>
          <Ionicons color={colors.accentText} name="resize-outline" size={22} />
        </View>
        <View style={styles.portionSelector}>
          {([
            { factor: 0.7 as PortionFactor, label: t.confirm.less, multiplier: `${formatNumber(0.7, locale)}×` },
            { factor: 1 as PortionFactor, label: t.confirm.fits, multiplier: '1×' },
            { factor: 1.4 as PortionFactor, label: t.confirm.more, multiplier: `${formatNumber(1.4, locale)}×` },
          ]).map((choice) => {
            const active = mealPortion === choice.factor;
            return (
              <Pressable
                aria-checked={active}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                key={choice.label}
                onPress={() => setMealPortion(choice.factor)}
                style={[styles.portionChoice, active && styles.portionChoiceActive]}
              >
                <Text style={[styles.portionChoiceLabel, active && styles.portionChoiceLabelActive]}>{choice.label}</Text>
                <Text style={[styles.portionMultiplier, active && styles.portionChoiceLabelActive]}>{choice.multiplier}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>
      ) : null}

      {detectedItems.map((item) => {
        const unresolved = needsIngredientCorrection(item);
        const selection = initialSelection(item.amountG, item.portions, { chosen: true });
        // "2 Eier · 116 g" reads naturally; a generic "1 Portion" adds nothing.
        const unit = selection.unitIndex >= 0 ? item.portions![selection.unitIndex].label : null;
        const count = Number(selection.amount);
        const amount = unit && unit !== t.scan.portionServing
          ? `${count === 1 ? unit : `${formatNumber(count, locale)} × ${unit}`} · ${formatNumber(item.amountG, locale)} g`
          : `${formatNumber(item.amountG, locale)} g`;
        return (
          <Card key={`ingredient-${item.id}`} style={styles.ingredientCard}>
            <View style={styles.ingredientRow}>
              <Pressable
                accessibilityLabel={`${item.name}: ${t.confirm.editAmount}`}
                accessibilityRole="button"
                disabled={unresolved}
                onPress={() => setAmountFor(item.id)}
                style={({ pressed }) => [styles.ingredientMain, pressed && { opacity: 0.6 }]}
              >
                <Text numberOfLines={2} style={[styles.ingredientName, !item.included && styles.itemRowOff]}>{item.name}</Text>
                <View style={styles.ingredientMetaRow}>
                  <Text style={styles.ingredientMeta}>{unresolved ? t.confirm.missingValues : `${amount} · ${formatNumber(item.calories, locale)} kcal`}</Text>
                  {!unresolved ? <Ionicons color={colors.accentText} name="pencil" size={13} /> : null}
                </View>
              </Pressable>
              <Pressable accessibilityLabel={`${item.name}: ${t.confirm.replaceFood}`} accessibilityRole="button" hitSlop={6} onPress={() => replaceFood(item.id)} style={styles.iconAction}>
                <Ionicons color={colors.text} name="swap-horizontal" size={18} />
              </Pressable>
              <Pressable accessibilityLabel={`${item.name}: ${t.confirm.removeFood}`} accessibilityRole="button" hitSlop={6} onPress={() => setRemoveFor(removeFor === item.id ? null : item.id)} style={styles.iconAction}>
                <Ionicons color={colors.text} name="trash-outline" size={18} />
              </Pressable>
            </View>
            {!unresolved && !item.included ? <Text style={styles.subtitle}>{t.confirm.excluded}</Text> : null}
            {!unresolved && autoMatchedItemIds.includes(item.id) ? (
              <View style={styles.autoMatchedRow}>
                <Ionicons color={colors.attentionText} name="alert-circle" size={15} />
                <Text style={styles.autoMatchedText}>{t.confirm.autoMatched}</Text>
              </View>
            ) : null}
            {unresolved ? <UnresolvedSuggestion item={item} duplicateOf={possibleDuplicate(item, detectedItems)} onRemove={() => removeDetectedItem(item.id)} onUse={(result) => replaceDetectedItem(item.id, result, item.amountG)} /> : null}
            {removeFor === item.id ? <View style={styles.removeRow}>
              <PrimaryButton icon="trash-outline" label={t.confirm.removeFood} onPress={() => { removeDetectedItem(item.id); setRemoveFor(null); }} variant="secondary" />
            </View> : null}
          </Card>
        );
      })}

      <PortionSheet
        onCancel={() => { setAmountFor(null); setPreferGrams(false); }}
        onConfirm={(grams) => {
          if (amountFor) setItemAmount(amountFor, grams);
          setAmountFor(null);
          setPreferGrams(false);
        }}
        target={(() => {
          const item = detectedItems.find((entry) => entry.id === amountFor);
          if (!item || needsIngredientCorrection(item) || item.baseAmountG < 1) return null;
          return {
            name: item.name,
            per100g: itemNutritionPer100g(item),
            defaultGrams: item.amountG,
            // This is the amount already on the meal, not a database default.
            amountIsChosen: true,
            preferGrams,
            portions: item.portions,
            sourceLabel: item.source.label,
          };
        })()}
        visible={amountFor !== null}
      />


      {correctionRequired ? <Card style={styles.ingredientCard}>
        <Text style={styles.portionTitle}>{t.confirm.incompleteTotal}</Text>
        <Text style={styles.subtitle}>{t.confirm.resolveFirst}</Text>
      </Card> : <Card style={styles.estimateCard}>
        <View style={styles.estimateCopy}>
          <Text style={styles.estimateLabel}>{t.confirm.currentEstimate}</Text>
          <Text style={styles.estimateValue}>~{formatNumber(scannedMeal.calories, locale)} kcal</Text>
        </View>
        <View style={styles.macroSummary}>
          <Text style={styles.macroSummaryText}>{scannedMeal.protein}g P</Text>
          <View style={styles.dot} />
          <Text style={styles.macroSummaryText}>{scannedMeal.carbs}g C</Text>
          <View style={styles.dot} />
          <Text style={styles.macroSummaryText}>{scannedMeal.fat}g F</Text>
        </View>
      </Card>}

      {!hasIncludedFood ? <Text style={styles.subtitle}>{t.confirm.emptyMeal}</Text> : null}
      {/* Starred here, stored by the save: the meal exactly as confirmed. The example meal never enters the diary. */}
      {scanMode !== 'demo' && canConfirm ? <FavoriteToggle onToast={showToast} /> : null}
      <PrimaryButton disabled={!canConfirm} icon="arrow-forward" label={t.confirm.proceed} onPress={confirm} />
      <PrimaryButton
        label={scanMode === 'plan' ? t.confirm.otherOption : scanMode === 'search' ? t.confirm.searchAgain : scanMode === 'description' ? t.confirm.editDescription : scanMode === 'barcode' ? t.confirm.scanAgain : t.confirm.retake}
        onPress={changeInput}
        variant="ghost"
      />
    </Screen>
  );
}

/**
 * An unresolved ingredient used to show only "?" and a separate search page.
 * Offer the best sourced match inline; nothing changes until the user taps it,
 * and the detected amount is kept.
 */
const foldWords = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(word => word.length > 2);
const stripEnding = (word: string) => (word.length > 5 ? word.replace(/(?:e|en|em|er|es)$/, '') : word);
/** An unresolved row that names a food already counted ("Hähnchenbrust gebraten" vs "gebratene Hähnchenbrust"). */
function possibleDuplicate(item: MealItem, items: MealItem[]) {
  const words = foldWords(item.name).map(stripEnding);
  if (!words.length) return null;
  return items.find((other) => other.id !== item.id && other.included && !needsIngredientCorrection(other)
    && words.every((word) => foldWords(other.name).map(stripEnding).includes(word))) ?? null;
}

function sharesFoodWord(detected: string, candidate: string) {
  const wanted = foldWords(detected).map(stripEnding);
  const offered = foldWords(candidate).map(stripEnding);
  return wanted.some(word => offered.some(other => other === word || (word.length >= 5 && (other.startsWith(word) || word.startsWith(other)))));
}

function UnresolvedSuggestion({ item, duplicateOf, onRemove, onUse }: { item: MealItem; duplicateOf: MealItem | null; onRemove: () => void; onUse: (result: FoodSearchResult) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { language, locale, t } = useLanguage();
  const [suggestion, setSuggestion] = useState<FoodSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSuggestion(null);
    searchIngredientReplacement(milkCorrectionQuery(item.name) ?? item.name)
      // Only a result that shares the food word is a suggestion; "High
      // Protein Joghurt" for meatballs is noise that makes people feel wrong.
      .then((results) => { if (active) setSuggestion(results.find(result => sharesFoodWord(item.name, result.name)) ?? null); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item.id, item.name, language]);
  const grams = item.amountG >= 1 && item.amountG <= 5000 ? item.amountG : null;
  // Never offer to complete a second copy of a food that is already counted.
  if (duplicateOf) {
    return (
      <View style={styles.suggestionBox}>
        <Text style={styles.subtitle}>{t.confirm.alreadyIncluded(duplicateOf.name)}</Text>
        <PrimaryButton icon="trash-outline" label={t.confirm.removeDuplicate} onPress={onRemove} variant="secondary" />
      </View>
    );
  }
  if (loading) {
    return <View style={styles.suggestionRow}><ActivityIndicator color={colors.accentText} /><Text style={styles.subtitle}>{t.confirm.suggestionLoading}</Text></View>;
  }
  if (!suggestion || grams === null) return null;
  const kcal = formatNumber(Math.round(suggestion.per100g.calories * grams / 100), locale);
  return (
    <View style={styles.suggestionBox}>
      <Text style={styles.subtitle}>{t.confirm.suggestionTitle}</Text>
      <PrimaryButton icon="checkmark" label={t.confirm.useSuggestion(suggestion.name, kcal)} onPress={() => { void successHaptic(); onUse(suggestion); }} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  suggestionBox: { gap: 8 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  iconButtonSpacer: { width: 42, height: 42 },
  topTitle: { ...typeScale.subhead, color: colors.text, fontWeight: '700' },
  heading: { gap: 8 },
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { maxWidth: '100%', flexShrink: 1, color: colors.text, fontSize: 30, lineHeight: 37, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { ...typeScale.subhead, color: colors.muted },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ingredientMain: { flex: 1, minWidth: 0, gap: 4, minHeight: 44, justifyContent: 'center' },
  ingredientName: { ...typeScale.label, color: colors.text, fontWeight: '700' },
  ingredientMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ingredientMeta: { ...typeScale.subhead, color: colors.muted, fontVariant: ['tabular-nums'] },
  iconAction: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  removeRow: { marginTop: 4 },
  analysisWarning: { borderRadius: 15, backgroundColor: colors.neutralSoft, paddingHorizontal: 13, paddingVertical: 10, gap: 6 },
  analysisWarningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  analysisWarningText: { ...typeScale.footnote, flex: 1, color: colors.text },
  estimateBanner: { minHeight: 48, borderRadius: 15, backgroundColor: colors.attentionSoft, borderWidth: 1, borderColor: colors.attention, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  estimateBannerText: { ...typeScale.subhead, flex: 1, color: colors.text, fontWeight: '700' },
  autoMatchedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  autoMatchedText: { ...typeScale.footnote, flex: 1, color: colors.text, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detectedChip: { minHeight: 44, borderRadius: radii.pill, backgroundColor: colors.successSoft, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  detectedChipQuestion: { backgroundColor: colors.attentionSoft },
  detectedChipOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  detectedChipText: { ...typeScale.caption, color: colors.text, fontWeight: '600' },
  detectedChipTextOff: { color: colors.muted, textDecorationLine: 'line-through' },
  listCard: { padding: 8 },
  portionCard: { gap: 16 },
  ingredientCard: { gap: 10 },
  ingredientActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ingredientAction: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', borderRadius: 12, backgroundColor: colors.neutralSoft },
  actionText: { ...typeScale.footnote, color: colors.accentText, fontWeight: '600', flexShrink: 1 },
  amountField: { minHeight: 60, borderRadius: radii.input, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.neutralSoft, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amountFieldValue: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
  portionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  portionTitle: { ...typeScale.headline, color: colors.text, fontWeight: '700' },
  portionSubtitle: { ...typeScale.caption, color: colors.muted, marginTop: 4 },
  portionSelector: { flexDirection: 'row', borderRadius: radii.input, backgroundColor: colors.neutralSoft, padding: 4, gap: 4 },
  portionChoice: { flex: 1, minHeight: 52, borderRadius: 11, alignItems: 'center', justifyContent: 'center', gap: 2 },
  portionChoiceActive: { backgroundColor: colors.accent },
  portionChoiceLabel: { ...typeScale.footnote, color: colors.muted, fontWeight: '700' },
  portionChoiceLabelActive: { color: colors.onAccent },
  portionMultiplier: { ...typeScale.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  detailsToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailsToggleText: { ...typeScale.caption, color: colors.muted, fontWeight: '600' },
  itemRow: { minHeight: 72, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 11, paddingHorizontal: 7, paddingVertical: 12 },
  itemRowOff: { opacity: 0.48 },
  checkButton: { width: 44, height: 44, borderRadius: 13, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkButtonOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  itemCopy: { flex: 1, minWidth: 0, gap: 3 },
  itemNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  itemName: { ...typeScale.subhead, flexShrink: 1, color: colors.text, fontWeight: '700' },
  uncertain: { ...typeScale.caption, color: colors.attentionText, fontWeight: '800', letterSpacing: 0.7 },
  itemCalories: { ...typeScale.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  stepper: { width: '100%', minHeight: 44, borderRadius: 14, backgroundColor: colors.background, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  amount: { ...typeScale.caption, minWidth: 44, color: colors.text, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 52 },
  estimateCard: { backgroundColor: colors.camera, borderColor: colors.camera, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  estimateCopy: { maxWidth: '100%' },
  estimateLabel: { ...typeScale.caption, color: 'rgba(255,255,255,0.58)', fontWeight: '800', letterSpacing: 0.9 },
  estimateValue: { ...typeScale.title2, color: colors.white, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  macroSummary: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: '100%', alignItems: 'center', gap: 6 },
  macroSummaryText: { ...typeScale.caption, color: colors.accent, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
});

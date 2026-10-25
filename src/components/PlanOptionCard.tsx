import Ionicons from '@expo/vector-icons/Ionicons';
import { PropsWithChildren, ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, PrimaryButton } from '@/components/ui';
import type { ThemeColors } from '@/constants/theme';
import { HERO_MAX_FONT_SCALE, radii, typeScale } from '@/constants/theme';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useLanguage } from '@/i18n/LanguageProvider';
import { selectionHaptic } from '@/services/haptics';
import { formatNumber } from '@/utils/format';
import type { OptionFit } from '@/utils/mealSuggestions';

/**
 * One option on Plan → "3 Optionen für heute", for every situation.
 *
 * Read top to bottom, a card answers the questions in the order people ask
 * them: how much is it (kcal and protein, big), what is it (a short title and
 * a fit badge), what do I get (at most three compact rows), and only then the
 * fine print (stores, carbs and fat, what is left afterwards) and one action.
 *
 * Zuhause, Supermarkt and Unterwegs all render through this file. The pieces
 * are exported so a different option source (restaurant chains) can compose
 * the same header, rows and footer instead of drawing its own card.
 */

export type PlanStoreChip = { id: string; label: string; accessibilityLabel: string };

export type PlanOptionItem = {
  key: string;
  name: string;
  /** Brand and per-item values, muted under the name. */
  detail?: string;
  /** "1 Becher", right aligned. */
  amount?: string;
  /** "450 g", muted under the amount. */
  amountDetail?: string;
  stores?: PlanStoreChip[];
};

export type PlanOptionAction = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'dark';
  disabled?: boolean;
};

/** Rows visible before "+N weitere". */
export const PLAN_VISIBLE_ITEMS = 3;

const FIT_ICON: Record<OptionFit, keyof typeof Ionicons.glyphMap> = {
  exact: 'checkmark-circle',
  protein: 'barbell-outline',
  light: 'leaf-outline',
};

/** "Passt genau" / "Proteinreich" / "Leicht": icon plus word, never colour alone. */
export function PlanFitBadge({ fit }: { fit: OptionFit | null }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  if (!fit) return null;
  return (
    <View style={styles.fitBadge}>
      <Ionicons color={colors.accentText} name={FIT_ICON[fit]} size={14} />
      <Text style={styles.fitText}>{t.plan.fit[fit]}</Text>
    </View>
  );
}

export function PlanOptionHeader({
  rank,
  calories,
  protein,
  estimated,
  title,
  subtitle,
  meta,
  fit,
}: {
  rank: number;
  calories: number;
  protein: number;
  /** Prefix the figures with "~". */
  estimated: boolean;
  title: string;
  subtitle?: string;
  /** Short context next to the title: "15 Min.", "Vietnamesisch". */
  meta?: string;
  fit: OptionFit | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { locale, t } = useLanguage();
  const prefix = estimated ? '~' : '';
  const kcal = `${prefix}${formatNumber(calories, locale)} kcal`;
  const proteinText = t.plan.optionProtein(`${prefix}${formatNumber(protein, locale)}`);
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Text accessibilityLabel={t.plan.optionRank(rank)} style={styles.rank}>{String(rank).padStart(2, '0')}</Text>
        <PlanFitBadge fit={fit} />
      </View>
      <View accessibilityLabel={`${kcal}, ${proteinText}`} accessible style={styles.figures}>
        <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} style={styles.kcal}>{kcal}</Text>
        <Text maxFontSizeMultiplier={HERO_MAX_FONT_SCALE} style={styles.protein}>{proteinText}</Text>
      </View>
      <View style={styles.titleBlock}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
          {meta ? <Text style={styles.meta}>{`  ·  ${meta}`}</Text> : null}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function PlanStoreChips({ stores }: { stores: PlanStoreChip[] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!stores.length) return null;
  return (
    <View style={styles.storeRow}>
      {stores.map((store) => (
        <View accessibilityLabel={store.accessibilityLabel} accessible key={store.id} style={styles.storeChip}>
          <Ionicons color={colors.muted} name="storefront-outline" size={12} />
          <Text style={styles.storeChipText}>{store.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function PlanItemRow({ item }: { item: PlanOptionItem }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.itemRow}>
      <View style={styles.itemDot} />
      <View style={styles.itemMain}>
        <View style={styles.itemLine}>
          <Text style={styles.itemName}>{item.name}</Text>
          {item.amount ? <Text style={styles.itemAmount}>{item.amount}</Text> : null}
        </View>
        {item.detail || item.amountDetail ? (
          <View style={styles.itemLine}>
            {item.detail ? <Text style={styles.itemDetail}>{item.detail}</Text> : <View style={styles.flexSpacer} />}
            {item.amountDetail ? <Text style={styles.itemAmountDetail}>{item.amountDetail}</Text> : null}
          </View>
        ) : null}
        {item.stores?.length ? <PlanStoreChips stores={item.stores} /> : null}
      </View>
    </View>
  );
}

/** At most three rows; the rest behind "+N weitere". */
export function PlanItemRows({ items, moreLabel }: { items: PlanOptionItem[]; moreLabel?: (hidden: number) => string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  const hidden = Math.max(0, items.length - PLAN_VISIBLE_ITEMS);
  const visible = expanded || !hidden ? items : items.slice(0, PLAN_VISIBLE_ITEMS);
  const toggleLabel = expanded ? t.plan.showFewer : (moreLabel ?? t.plan.moreItems)(hidden);
  return (
    <View style={styles.items}>
      {visible.map((item) => <PlanItemRow item={item} key={item.key} />)}
      {hidden ? (
        <Pressable
          accessibilityLabel={toggleLabel}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={8}
          onPress={() => { void selectionHaptic(); setExpanded((value) => !value); }}
          style={styles.moreButton}
        >
          <Text style={styles.moreText}>{toggleLabel}</Text>
          <Ionicons color={colors.accentText} name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Carbs and fat as one muted line; the big figures already carry kcal and protein. */
export function PlanMacroLine({ carbs, fat, estimated, extra }: { carbs: number; fat: number; estimated: boolean; extra?: string }) {
  const styles = useThemedStyles(makeStyles);
  const { locale, t } = useLanguage();
  const prefix = estimated ? '~' : '';
  const line = t.plan.macroLine(`${prefix}${formatNumber(carbs, locale)}`, `${prefix}${formatNumber(fat, locale)}`);
  return <Text style={styles.macroLine}>{extra ? `${line} · ${extra}` : line}</Text>;
}

/**
 * "Danach etwa 680 kcal übrig" with a thin bar of how much of what is left
 * this option uses. Over the target, the bar is full and amber, the words say
 * how far over, and nothing scolds.
 */
export function PlanAfterHint({ calories, availableCalories }: { calories: number; availableCalories: number }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { locale, t } = useLanguage();
  const after = Math.round(availableCalories - calories);
  const over = after < 0;
  const share = availableCalories > 0 ? Math.min(1, Math.max(0, calories / availableCalories)) : 1;
  const text = over ? t.plan.afterOver(formatNumber(-after, locale)) : t.plan.afterLeft(formatNumber(after, locale));
  return (
    <View accessibilityLabel={text} accessible style={styles.after}>
      <View style={styles.afterTrack}>
        <View style={[styles.afterFill, { width: `${Math.round(share * 100)}%`, backgroundColor: over ? colors.attention : colors.accent }]} />
      </View>
      <Text style={styles.afterText}>{text}</Text>
    </View>
  );
}

export function PlanOptionFooter({
  carbs,
  fat,
  estimated,
  macroExtra,
  notes = [],
  calories,
  availableCalories,
  action,
}: {
  carbs: number;
  fat: number;
  estimated: boolean;
  macroExtra?: string;
  /** Small muted lines such as "70 % einer Standardportion". */
  notes?: string[];
  calories: number;
  availableCalories: number;
  action: PlanOptionAction;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.footer}>
      <View style={styles.fineprint}>
        <PlanMacroLine carbs={carbs} estimated={estimated} extra={macroExtra} fat={fat} />
        {notes.map((note) => <Text key={note} style={styles.note}>{note}</Text>)}
      </View>
      <PlanAfterHint availableCalories={availableCalories} calories={calories} />
      <PrimaryButton disabled={action.disabled} icon={action.icon} label={action.label} onPress={action.onPress} variant={action.variant ?? 'secondary'} />
    </View>
  );
}

/** The shared shell: header, rows, footer, and room for situation extras (recipe link, portion picker). */
export function PlanOptionCard({
  chosen = false,
  header,
  items = [],
  moreLabel,
  footer,
  children,
}: PropsWithChildren<{
  chosen?: boolean;
  header: Parameters<typeof PlanOptionHeader>[0];
  items?: PlanOptionItem[];
  moreLabel?: (hidden: number) => string;
  footer: Parameters<typeof PlanOptionFooter>[0];
  children?: ReactNode;
}>) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Card style={[styles.card, chosen && styles.cardChosen]}>
      <PlanOptionHeader {...header} />
      <PlanItemRows items={items} moreLabel={moreLabel} />
      <PlanOptionFooter {...footer} />
      {children}
    </Card>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: { gap: 18, paddingVertical: 20 },
  cardChosen: { borderColor: colors.accentText, backgroundColor: colors.accentSoft },
  header: { gap: 6 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 26 },
  rank: { ...typeScale.caption, color: colors.muted, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: 0.6 },
  fitBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radii.pill, backgroundColor: colors.accentSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accent, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 1 },
  fitText: { ...typeScale.caption, color: colors.accentText, fontWeight: '700' },
  figures: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10, rowGap: 0 },
  kcal: { ...typeScale.title2, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  protein: { ...typeScale.headline, color: colors.accentText, fontWeight: '700', fontVariant: ['tabular-nums'] },
  titleBlock: { gap: 2 },
  title: { ...typeScale.label, color: colors.text, fontWeight: '600' },
  meta: { ...typeScale.subhead, color: colors.muted, fontWeight: '400' },
  subtitle: { ...typeScale.footnote, color: colors.muted },
  items: { gap: 10, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  itemDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 7 },
  itemMain: { flex: 1, minWidth: 0, gap: 2 },
  itemLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 10 },
  itemName: { ...typeScale.subhead, color: colors.text, fontWeight: '600', flexShrink: 1 },
  itemAmount: { ...typeScale.subhead, color: colors.text, fontVariant: ['tabular-nums'], marginLeft: 'auto', textAlign: 'right' },
  itemDetail: { ...typeScale.caption, color: colors.muted, flexShrink: 1 },
  itemAmountDetail: { ...typeScale.caption, color: colors.muted, fontVariant: ['tabular-nums'], marginLeft: 'auto', textAlign: 'right' },
  flexSpacer: { flex: 1 },
  storeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  storeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radii.pill, backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 2 },
  storeChipText: { ...typeScale.caption, color: colors.text, fontWeight: '600' },
  moreButton: { alignSelf: 'flex-start', minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 16 },
  moreText: { ...typeScale.footnote, color: colors.accentText, fontWeight: '700' },
  footer: { gap: 12 },
  fineprint: { gap: 2 },
  macroLine: { ...typeScale.footnote, color: colors.muted, fontVariant: ['tabular-nums'] },
  note: { ...typeScale.caption, color: colors.muted },
  after: { gap: 6 },
  afterTrack: { height: 4, borderRadius: 2, backgroundColor: colors.neutralSoft, overflow: 'hidden' },
  afterFill: { height: 4, borderRadius: 2 },
  afterText: { ...typeScale.footnote, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

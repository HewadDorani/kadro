import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { useEffect, useState } from 'react';

/**
 * The market whose shelves Kandro suggests from: product search, barcode
 * lookup order, supermarket baskets and store brands.
 *
 * 'de' covers Germany, Austria and Switzerland; 'gb' the United Kingdom; 'us'
 * the United States. The device region decides (expo-localization), not the
 * app language: somebody in London with the app in German still shops at
 * Tesco. Other regions fall back to the device language (German → 'de',
 * anything else → 'us'). The person can override it in Du → "Land für
 * Vorschläge"; the choice stays on this device (AsyncStorage) and is sent to
 * Kandro's server only as the `region` parameter of product searches and
 * barcode lookups.
 */
export type MarketRegion = 'de' | 'gb' | 'us';
/** What the person chose in Du: a market, or follow the device. */
export type MarketRegionSetting = MarketRegion | 'auto';

export const MARKET_REGIONS: readonly MarketRegion[] = ['de', 'gb', 'us'];
export const MARKET_REGION_KEY = '@kandro/market-region:v1';

const DACH = new Set(['DE', 'AT', 'CH']);

export const isMarketRegion = (value: unknown): value is MarketRegion =>
  value === 'de' || value === 'gb' || value === 'us';

/** Pure mapping, exported for tests: ISO region code and language code → market. */
export function marketRegionFor(regionCode?: string | null, languageCode?: string | null): MarketRegion {
  const region = (regionCode ?? '').toUpperCase();
  if (DACH.has(region)) return 'de';
  if (region === 'GB' || region === 'UK') return 'gb';
  if (region === 'US') return 'us';
  return (languageCode ?? '').toLowerCase().split(/[-_]/)[0] === 'de' ? 'de' : 'us';
}

/** The market the device settings point to, ignoring any override. */
export function deviceMarketRegion(): MarketRegion {
  try {
    const locale = getLocales()[0];
    let region = locale?.regionCode ?? null;
    if (!region && locale?.languageTag) {
      try {
        region = new Intl.Locale(locale.languageTag.replace(/_/g, '-')).region ?? null;
      } catch {
        region = null;
      }
    }
    return marketRegionFor(region, locale?.languageCode ?? locale?.languageTag);
  } catch {
    return 'us';
  }
}

let override: MarketRegion | null = null;
let loading: Promise<void> | null = null;
/** Bumped by every choice in Du, so a slower read of the old value cannot undo it. */
let choices = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Reads the saved override once; later calls share the same read. */
export function loadMarketRegion(): Promise<void> {
  const before = choices;
  loading ??= AsyncStorage.getItem(MARKET_REGION_KEY)
    .then((stored) => {
      const next = isMarketRegion(stored) ? stored : null;
      if (choices === before && next !== override) {
        override = next;
        notify();
      }
    })
    .catch(() => undefined);
  return loading;
}

/** The market in effect now: the override, else the device. Synchronous. */
export function getMarketRegion(): MarketRegion {
  return override ?? deviceMarketRegion();
}

export function getMarketRegionSetting(): MarketRegionSetting {
  return override ?? 'auto';
}

/** Saves the choice ('auto' clears it) and re-renders every useMarketRegion. */
export async function setMarketRegionSetting(setting: MarketRegionSetting) {
  const next = isMarketRegion(setting) ? setting : null;
  // A choice made before the stored one was read must not be overwritten by it.
  choices += 1;
  loading ??= Promise.resolve();
  if (next !== override) {
    override = next;
    notify();
  }
  try {
    if (next) await AsyncStorage.setItem(MARKET_REGION_KEY, next);
    else await AsyncStorage.removeItem(MARKET_REGION_KEY);
  } catch {
    // The choice still applies for this session.
  }
}

function useRegionState<T>(read: () => T): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read);
    listeners.add(update);
    update();
    void loadMarketRegion();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return value;
}

/** The market in effect; re-renders when the override changes. */
export function useMarketRegion(): MarketRegion {
  return useRegionState(getMarketRegion);
}

/** The Du setting ('auto' or a market) plus the market it resolves to. */
export function useMarketRegionSetting() {
  const setting = useRegionState(getMarketRegionSetting);
  const region = useRegionState(getMarketRegion);
  return { setting, region, device: deviceMarketRegion(), setSetting: setMarketRegionSetting };
}

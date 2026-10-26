import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';

import { de } from '@/i18n/de';
import { en } from '@/i18n/en';

export type Language = 'de' | 'en';
export type Dictionary = typeof de;

const LANGUAGE_KEY = '@kandro/language:v1';

const dictionaries: Record<Language, Dictionary> = { de, en };

/**
 * Choose the first supported language in the device's preference order.
 * English is the fallback when none is supported; saved app choice wins in
 * loadLanguage. Food references are available independently of app language.
 */
export function deviceLanguage(): Language {
  for (const locale of getLocales()) {
    const tag = (locale.languageCode ?? locale.languageTag?.split(/[-_]/)[0])?.toLowerCase();
    if (tag === 'de' || tag === 'en') return tag;
  }
  return 'en';
}

/**
 * Where the device says it is, independent of the app's language.
 *
 * The two must not be conflated: the app tag for English is en-GB, so deriving
 * units from it handed every American stone and pounds. Somebody in Texas with
 * their phone in German is still weighed in pounds.
 */
export function deviceRegion(): string | undefined {
  const locale = getLocales()[0];
  if (locale?.regionCode) return locale.regionCode.toUpperCase();
  // A language tag may contain a script before the region, e.g. zh-Hans-SG.
  try {
    return locale?.languageTag ? new Intl.Locale(locale.languageTag.replaceAll('_', '-')).region : undefined;
  } catch {
    return undefined;
  }
}

export async function loadLanguage(): Promise<Language> {
  const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
  if (stored === 'de' || stored === 'en') return stored;
  return deviceLanguage();
}

export async function saveLanguage(language: Language) {
  await AsyncStorage.setItem(LANGUAGE_KEY, language);
}

export function dictionaryFor(language: Language): Dictionary {
  return dictionaries[language] ?? en;
}

/** BCP 47 tag for Intl formatting and for what we ask the analysis model for. */
/**
 * Number, date and clock format. English follows the shopping country: an
 * American reads "6:30 PM" and "October 26", everyone else the British
 * 24-hour clock and "26 October".
 */
export function localeTag(language: Language, market?: 'de' | 'gb' | 'us') {
  if (language === 'de') return 'de-DE';
  return market === 'us' ? 'en-US' : 'en-GB';
}

export { de, en };

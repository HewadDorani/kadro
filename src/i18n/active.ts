import { Dictionary, Language, dictionaryFor, localeTag } from '@/i18n';

/**
 * The active dictionary for code that cannot use the React hook.
 *
 * Services throw and format messages that the user reads: a failed deletion,
 * a rejected email, the evening notification. Threading the dictionary through
 * every signature would touch call sites that have nothing to do with language,
 * so the provider publishes it here instead and non-React code reads it.
 *
 * English is the starting value because it is the app's default language; the
 * provider overwrites it during its first render, before any screen mounts.
 */
let active: Dictionary = dictionaryFor('en');
let activeLocale = localeTag('en');
let activeLanguage: Language = 'en';

export function setActiveDictionary(language: Language, market?: 'de' | 'gb' | 'us') {
  active = dictionaryFor(language);
  activeLocale = localeTag(language, market);
  activeLanguage = language;
}

export function getDictionary(): Dictionary {
  return active;
}

/** BCP 47 tag for number and date formatting outside React. */
export function getLocale() {
  return activeLocale;
}

/** The active language, for code that picks a data file rather than a string. */
export function getLanguage(): Language {
  return activeLanguage;
}

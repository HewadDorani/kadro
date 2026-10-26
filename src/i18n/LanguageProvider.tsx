import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  Dictionary,
  Language,
  dictionaryFor,
  deviceLanguage,
  loadLanguage,
  localeTag,
  saveLanguage,
} from '@/i18n';
import { setActiveDictionary } from '@/i18n/active';
import { getMarketRegion, useMarketRegion } from '@/services/region';
import { applyNotificationChannel, syncEveningReminder } from '@/services/reminders';
import { LegalCopySet, legalDe } from '@/i18n/legal.de';
import { legalEn } from '@/i18n/legal.en';

type LanguageContextValue = {
  language: Language;
  /** Dictionary for the active language. */
  t: Dictionary;
  /** Privacy, terms and sources copy; kept word-for-word in sync with getkandro.com. */
  legal: LegalCopySet;
  locale: string;
  ready: boolean;
  setLanguage: (language: Language) => Promise<void>;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  // Start from the device so the very first frame is already in the right
  // language; the stored override replaces it once storage has answered.
  const [language, setLanguageState] = useState<Language>(deviceLanguage);
  const market = useMarketRegion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadLanguage().then((stored) => {
      if (!active) return;
      setLanguageState(stored);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Also on boot, not just on a switch: the stored language arrives a render
  // after the device guess, and the channel name is what the user reads in
  // Android's own settings.
  useEffect(() => {
    applyNotificationChannel();
  }, [language]);

  const setLanguage = useCallback(async (next: Language) => {
    setLanguageState(next);
    setActiveDictionary(next, getMarketRegion());
    await saveLanguage(next);
    // A notification is written once and fires days later, so an already
    // scheduled reminder would keep speaking the old language.
    await syncEveningReminder().catch(() => undefined);
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    // Publish during render, not in an effect: a service called from the very
    // first screen must already see the right language.
    setActiveDictionary(language, market);
    return {
    language,
    t: dictionaryFor(language),
    legal: language === 'de' ? legalDe : legalEn,
    locale: localeTag(language, market),
    ready,
    setLanguage,
    };
  }, [language, market, ready, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider');
  return value;
}

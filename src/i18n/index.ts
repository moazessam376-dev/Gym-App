// i18n framework (Phase 14b). Wires expo-localization (device locale) + i18next +
// react-i18next so every screen can call `t('...')` and the app can flip language
// and writing direction. This is the FRAMEWORK only — English is the sole bundled
// language for now; the full Arabic translation + RTL QA is Phase 16. Adding Arabic
// later = drop in `ar.json`, add 'ar' to SUPPORTED_LANGUAGES + RTL_LANGUAGES.
//
// Strings are bundled (no async backend), so i18next initializes synchronously when
// this module is imported — importing it once at app entry is enough for `t()` to
// work app-wide. A persisted override is applied async after init.
import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getPref, setPref } from '../lib/prefs';
import en from './locales/en.json';
import ar from './locales/ar.json';

export const SUPPORTED_LANGUAGES = ['en', 'ar'] as const; // Phase 16: Egyptian Arabic
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

// Display names for the switcher UI (each in its own script).
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  ar: 'العربية',
};

// Languages that render right-to-left (Phase 16: Arabic).
const RTL_LANGUAGES = new Set<string>(['ar']);

const LANGUAGE_PREF_KEY = 'app.language';

function isSupported(lng: string | null | undefined): lng is Language {
  return !!lng && (SUPPORTED_LANGUAGES as readonly string[]).includes(lng);
}

export function isRTLLanguage(lng: string): boolean {
  return RTL_LANGUAGES.has(lng);
}

// Apply writing direction for a language. I18nManager.forceRTL is a NATIVE setting:
// on Android it only fully takes effect once the native Activity is recreated. So on an
// LTR↔RTL switch the LanguageSwitcher does a real native restart (src/lib/restart.ts →
// react-native-restart; a JS-only reloadAppAsync left the bottom tab bar in the old
// direction). A cold boot always re-applies the saved direction before first paint
// (loadSavedLanguage + the boot gate in app/_layout.tsx).
function applyDirection(lng: string): void {
  const rtl = isRTLLanguage(lng);
  if (I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  }
}

// Start in the device language if we support it, else English. A saved override
// (if any) is applied right after by loadSavedLanguage().
const deviceLanguage = getLocales()[0]?.languageCode ?? 'en';
const initialLanguage: Language = isSupported(deviceLanguage) ? deviceLanguage : 'en';

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initialLanguage,
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});
applyDirection(initialLanguage);

/** Apply a previously-saved language override. Call once at app start. */
export async function loadSavedLanguage(): Promise<void> {
  try {
    const saved = await getPref(LANGUAGE_PREF_KEY);
    if (isSupported(saved) && saved !== i18n.language) {
      await i18n.changeLanguage(saved);
      applyDirection(saved);
    }
  } catch {
    /* preference read failed — stay on the device/default language */
  }
}

/**
 * Switch the UI language and persist the choice. Returns whether a reload is needed
 * for the writing direction to fully apply (true only when crossing an LTR↔RTL
 * boundary — relevant once Arabic ships in Phase 16).
 */
export async function setLanguage(lng: Language): Promise<{ needsReload: boolean }> {
  const directionChanged = isRTLLanguage(lng) !== I18nManager.isRTL;
  await i18n.changeLanguage(lng);
  applyDirection(lng);
  await setPref(LANGUAGE_PREF_KEY, lng);
  return { needsReload: directionChanged };
}

export default i18n;

// Language switcher (Phase 16). A two-option Segmented (English · العربية) that flips
// the UI language and writing direction. Switching English⇄Arabic always crosses the
// LTR↔RTL boundary. I18nManager.forceRTL is a NATIVE setting that only takes full effect
// when the native Activity is recreated, so we confirm first, then do a real native
// restart (restartApp → react-native-restart, with a reloadAppAsync fallback). A JS-only
// reload left the bottom tab bar in the old direction on Android. The chosen language is
// persisted by setLanguage(); on the next boot loadSavedLanguage()+applyDirection re-apply
// it before first paint. English stays available — the app is bilingual, not Arabic-only.
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  isRTLLanguage,
  LANGUAGE_NAMES,
  setLanguage,
  SUPPORTED_LANGUAGES,
  type Language,
} from '@/i18n';
import { confirm } from '@/lib/confirm';
import { isExpoGo, restartApp } from '@/lib/restart';
import { Text, Segmented } from '@/components/ui';
import { theme } from '@/theme';

export function LanguageSwitcher() {
  const { t, i18n: inst } = useTranslation();
  const current = (inst.language?.split('-')[0] as Language) ?? 'en';

  const options = SUPPORTED_LANGUAGES.map((lng) => ({ value: lng, label: LANGUAGE_NAMES[lng] }));

  const onChange = async (lng: Language) => {
    if (lng === current) return;
    // Crossing the writing-direction boundary needs a reload to fully apply. Confirm
    // BEFORE switching so a cancel leaves everything exactly as it was.
    const needsReload = isRTLLanguage(lng) !== isRTLLanguage(current);
    if (needsReload) {
      // Expo Go can't recreate the native Activity, so a forceRTL flip there only
      // applies after the user fully closes and reopens the app — tell them that
      // honestly instead of promising an auto-restart that can't change direction.
      const expoGo = isExpoGo();
      const ok = await confirm(
        t('language.restartTitle'),
        expoGo ? t('language.restartBodyManual') : t('language.restartBody'),
        expoGo ? t('common.done') : t('language.restartConfirm'),
        t('common.cancel'),
      );
      if (!ok) return;
      await setLanguage(lng);
      if (!expoGo) await restartApp();
      return;
    }
    await setLanguage(lng);
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="label" muted>
        {t('language.title')}
      </Text>
      <Segmented options={options} value={current} onChange={onChange} />
    </View>
  );
}

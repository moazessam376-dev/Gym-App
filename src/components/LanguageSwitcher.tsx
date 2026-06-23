// Language switcher (Phase 16). A two-option Segmented (English · العربية) that flips
// the UI language and writing direction. Switching English⇄Arabic always crosses the
// LTR↔RTL boundary, which React Native only fully applies after a bundle reload — so we
// confirm first, then reloadAppAsync() (exported by `expo`, works in Expo Go + release,
// no extra dependency). The chosen language is persisted by setLanguage(); on the next
// boot loadSavedLanguage()+applyDirection re-apply it before first paint. English stays
// available here — the app is bilingual, not Arabic-only.
import { View } from 'react-native';
import { reloadAppAsync } from 'expo';
import { useTranslation } from 'react-i18next';
import {
  isRTLLanguage,
  LANGUAGE_NAMES,
  setLanguage,
  SUPPORTED_LANGUAGES,
  type Language,
} from '@/i18n';
import { confirm } from '@/lib/confirm';
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
      const ok = await confirm(
        t('language.restartTitle'),
        t('language.restartBody'),
        t('language.restartConfirm'),
        t('common.cancel'),
      );
      if (!ok) return;
      await setLanguage(lng);
      await reloadAppAsync();
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

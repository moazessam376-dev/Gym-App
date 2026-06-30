// Settings hub — the app-preferences that used to clutter the Account tab
// (notifications, language, community guidelines). Account now keeps only identity
// + role actions and links here. All roles share this screen.
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SettingsLinkRow, SettingsSectionLabel } from '../src/components/SettingsRow';
import { LanguageSwitcher } from '../src/components/LanguageSwitcher';
import { Screen } from '../src/components/ui';
import { SettingsDesktop } from '../src/components/coach/web/SettingsDesktop';
import { useChrome } from '../src/lib/chrome';
import { theme } from '../src/theme';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const go = (href: Href) => () => router.push(href);
  // In the desktop coach shell, render the rich settings layout (account / notifications
  // / call availability / billing / language). Mobile keeps the link-list hub unchanged.
  const { active: wide } = useChrome();

  if (wide) {
    return (
      <Screen scroll gradient maxWidth={640} contentStyle={{ paddingTop: theme.spacing.lg }}>
        <SettingsDesktop />
      </Screen>
    );
  }

  return (
    <Screen scroll gradient maxWidth={wide ? 640 : undefined} contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.sm }}>
      <SettingsSectionLabel>{t('account.sectionProfile')}</SettingsSectionLabel>
      <SettingsLinkRow
        icon="notifications-outline"
        label={t('account.notifications')}
        onPress={go('/notification-settings')}
      />
      <SettingsLinkRow
        icon="book-outline"
        label={t('account.communityGuidelines')}
        onPress={go('/community-guidelines')}
      />

      <SettingsSectionLabel>{t('account.sectionPreferences')}</SettingsSectionLabel>
      <View>
        <LanguageSwitcher />
      </View>
    </Screen>
  );
}

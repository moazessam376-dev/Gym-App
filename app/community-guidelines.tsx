// Community Guidelines — the permanent, bilingual home for the conduct rules +
// legal-escalation wording (Phase 18 Slice 3). Static content; linked from Account,
// the report sheet, and the in-chat disclaimer gate.
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName, Screen, Text } from '../src/components/ui';
import { theme } from '../src/theme';


function Section({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Icon name={icon} size={18} color={theme.colors.primary} />
        <Text variant="bodyStrong">{title}</Text>
      </View>
      <Text variant="body" muted>
        {body}
      </Text>
    </View>
  );
}

export default function CommunityGuidelines() {
  const { t } = useTranslation();
  return (
    <Screen gradient scroll contentStyle={{ gap: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
      <Stack.Screen options={{ title: t('guidelines.title') }} />
      <Text variant="body" muted>
        {t('guidelines.intro')}
      </Text>
      <Section icon="happy-outline" title={t('guidelines.conductTitle')} body={t('guidelines.conductBody')} />
      <Section icon="ban-outline" title={t('guidelines.banTitle')} body={t('guidelines.banBody')} />
      <Section icon="flag-outline" title={t('guidelines.reportTitle')} body={t('guidelines.reportBody')} />
      <Section icon="refresh-outline" title={t('guidelines.appealTitle')} body={t('guidelines.appealBody')} />
      <Section icon="document-text-outline" title={t('guidelines.legalTitle')} body={t('guidelines.legalBody')} />
    </Screen>
  );
}

// Calls — deferred feature placeholder. In-app scheduled audio/video (coach availability,
// booking, live calls) needs an external video provider + a native dev build, so it ships
// as a "Coming soon" panel for now; the sidebar links here so the nav is complete. Built
// as its own future plan (see the web-portal plan, Part 2). Coach-only.
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { Screen, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function CoachCallsScreen() {
  const { t } = useTranslation();
  const { role } = useAuth();

  if (role && role !== 'coach') return <Redirect href="/" />;

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.xxl }}>
      <EmptyState
        icon="video"
        title={t('webnav.callsSoonTitle')}
        subtitle={t('webnav.callsSoonSub')}
      />
    </Screen>
  );
}

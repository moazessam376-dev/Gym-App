// Standalone /leaderboards route (Phase 20 + Slice G1). The screen body lives in a shared
// component (src/components/leaderboards/LeaderboardsScreen) so the coach's Leaderboard
// bottom tab (app/(tabs)/board.tsx) can reuse it. This route keeps the native stack header
// + back button — it's how the CLIENT reaches the boards (Home trophy / league card).
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LeaderboardsScreen } from '../../src/components/leaderboards/LeaderboardsScreen';

export default function LeaderboardsRoute() {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: t('leaderboards.title') }} />
      <LeaderboardsScreen />
    </>
  );
}

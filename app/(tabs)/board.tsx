// Coach "Leaderboard" bottom tab. Renders the shared leaderboards screen in tab mode
// (own in-screen title + top safe-area, no stack header). The route name is `board` to
// avoid colliding with the standalone /leaderboards route the client reaches from the
// Home trophy. Hidden from the bar for non-coaches (app/(tabs)/_layout.tsx); the boards
// themselves are public to any authenticated member, so no role redirect is needed.
import { LeaderboardsScreen } from '../../src/components/leaderboards/LeaderboardsScreen';

export default function LeaderboardTab() {
  return <LeaderboardsScreen inTab />;
}

// Messages tab. The messaging backend is live (src/lib/messages.ts: send,
// listConversation, realtime), but the chat thread UI is a later wave — this tab
// is the placeholder entry point so the navigation is complete today.
import { View } from 'react-native';
import { Screen, Text, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function MessagesTab() {
  return (
    <Screen padded={false} gradient>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
        <Text variant="h1">Chat</Text>
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          icon="chatbubbles-outline"
          title="Messaging is almost here"
          subtitle="Direct chat between you and your coach is coming soon."
        />
      </View>
    </Screen>
  );
}

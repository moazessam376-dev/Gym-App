// The home-header bell: a tappable icon with an unread badge that routes to the
// notification feed. The count comes from the cached/realtime ['notifications-unread']
// query, so it updates live (Phase 17). Used in the Client + Coach home headers.
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useUnreadNotificationCount } from '@/lib/queries/home';
import { Text } from '@/components/ui';
import { theme } from '@/theme';

export function NotificationBell({ size = 24 }: { size?: number }) {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const { data: count = 0 } = useUnreadNotificationCount(userId);
  const hasUnread = count > 0;

  return (
    <Pressable onPress={() => router.push('/notifications')} hitSlop={8}>
      <Ionicons
        name={hasUnread ? 'notifications' : 'notifications-outline'}
        size={size}
        color={theme.colors.text}
      />
      {hasUnread ? (
        <View
          style={{
            position: 'absolute',
            top: -5,
            right: -6,
            minWidth: 17,
            height: 17,
            borderRadius: 9,
            paddingHorizontal: 3,
            backgroundColor: theme.colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: theme.colors.bg,
          }}
        >
          <Text variant="caption" style={{ color: '#fff', fontSize: 10, lineHeight: 12 }}>
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

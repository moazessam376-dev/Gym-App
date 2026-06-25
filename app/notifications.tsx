// The in-app notification feed (Phase 17, Slice 1). Reads the cached ['notifications']
// query (warmed at boot, kept live by the root realtime subscription). Tapping a row
// marks it read and deep-links to its target; a header action marks the whole feed read.
// Copy is rendered from each row's type + params, so it follows the active language.
import { useCallback } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { queryClient } from '@/lib/query';
import { useNotifications, useUnreadNotificationCount, useRefreshOnFocus } from '@/lib/queries/home';
import {
  describeNotification,
  notificationHref,
  relativeTimeParts,
  markAllRead,
  markRead,
  type NotificationRow,
} from '@/lib/notifications';
import { Icon, Screen, Text, EmptyState, Button } from '@/components/ui';
import { theme } from '@/theme';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const feedQ = useNotifications(userId);
  const unreadQ = useUnreadNotificationCount(userId);
  useRefreshOnFocus(() => {
    feedQ.refetch();
    unreadQ.refetch();
  });

  const rows = feedQ.data ?? [];
  const unread = unreadQ.data ?? 0;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread', userId] });
  }, [userId]);

  const onPressRow = useCallback(
    (row: NotificationRow) => async () => {
      if (!row.read_at) {
        try {
          await markRead(row.id);
        } catch {
          /* non-fatal — navigating is the priority */
        }
        invalidate();
      }
      const href = notificationHref(row);
      if (href) router.push(href);
    },
    [invalidate, router],
  );

  const onMarkAll = useCallback(async () => {
    try {
      await markAllRead();
    } catch {
      /* non-fatal */
    }
    invalidate();
  }, [invalidate]);

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.md }}>
      <Stack.Screen options={{ title: t('notifications.title') }} />

      {unread > 0 ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Button title={t('notifications.markAllRead')} variant="ghost" onPress={onMarkAll} />
        </View>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title={t('notifications.emptyTitle')}
          subtitle={t('notifications.emptySub')}
        />
      ) : (
        rows.map((row) => {
          const { icon, title, body } = describeNotification(row, t);
          const { key, count } = relativeTimeParts(row.created_at);
          const isUnread = !row.read_at;
          return (
            <Pressable
              key={row.id}
              onPress={onPressRow(row)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.lg,
                backgroundColor: isUnread ? theme.colors.glass : theme.colors.surface,
                borderRadius: theme.radii.md,
                borderWidth: 1,
                borderColor: isUnread ? theme.colors.glassBorder : theme.colors.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radii.full,
                  backgroundColor: theme.colors.surfaceElevated,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={icon} size={20} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{title}</Text>
                <Text variant="caption" muted>
                  {body}
                </Text>
                <Text variant="caption" style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                  {t(key, { n: count })}
                </Text>
              </View>
              {isUnread ? (
                <View
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: theme.colors.primary,
                  }}
                />
              ) : null}
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

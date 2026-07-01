// Notification preferences (Phase 17, Slice 1): one toggle per event type. Defaults
// are all ON; a toggle upserts the caller's notification_prefs row (RLS pins user_id
// to them). Linked from Account. Future slices add channel (push/email) + quiet-hours.
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { queryClient } from '@/lib/query';
import {
  getNotificationPrefs,
  setNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefKey,
} from '@/lib/notifications';
import { Icon, type IconName, Screen, Text, Card } from '@/components/ui';
import { theme } from '@/theme';


const ROWS: { key: NotificationPrefKey; icon: IconName; labelKey: string }[] = [
  { key: 'message', icon: 'chatbubble-ellipses-outline', labelKey: 'notifications.prefs.message' },
  { key: 'coach_comment', icon: 'chatbox-ellipses-outline', labelKey: 'notifications.prefs.coachComment' },
  { key: 'plan_published', icon: 'document-text-outline', labelKey: 'notifications.prefs.planPublished' },
  { key: 'pr_achieved', icon: 'trophy-outline', labelKey: 'notifications.prefs.prAchieved' },
  { key: 'client_note', icon: 'clipboard-outline', labelKey: 'notifications.prefs.clientNote' },
  { key: 'coach_request', icon: 'user-plus', labelKey: 'notifications.prefs.coachRequest' },
];

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const prefsQ = useQuery({
    queryKey: ['notification-prefs', userId],
    queryFn: () => getNotificationPrefs(),
    enabled: !!userId,
  });

  // Local mirror for instant toggle feedback; reverts if the write fails.
  const [local, setLocal] = useState<NotificationPrefs | null>(null);
  useEffect(() => {
    if (prefsQ.data) setLocal(prefsQ.data);
  }, [prefsQ.data]);

  const onToggle = (key: NotificationPrefKey) => async (value: boolean) => {
    if (!local || !userId) return;
    const prev = local;
    const next = { ...local, [key]: value };
    setLocal(next);
    try {
      await setNotificationPrefs(userId, next);
      queryClient.invalidateQueries({ queryKey: ['notification-prefs', userId] });
    } catch {
      setLocal(prev); // revert on failure
    }
  };

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.md }}>
      <Stack.Screen options={{ title: t('notifications.settingsTitle') }} />

      <Text variant="caption" muted>
        {t('notifications.settingsSub')}
      </Text>

      <Card style={{ gap: theme.spacing.sm }}>
        {ROWS.map((row, i) => (
          <View
            key={row.key}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: theme.colors.border,
            }}
          >
            <Icon name={row.icon} size={20} color={theme.colors.primary} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t(row.labelKey)}
            </Text>
            <Switch
              value={local ? local[row.key] : true}
              onValueChange={onToggle(row.key)}
              disabled={!local}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor="#fff"
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}

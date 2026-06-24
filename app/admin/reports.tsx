// Admin → review reported chat messages (Phase 18 safety). The queue is RLS-scoped
// to admins. Each decision (dismiss / ban / unban) routes through the
// moderate-message-report Edge Function (the only writer of report status + the ban).
// The reported message is shown from the immutable snapshot on the report row —
// admins have NO live DM read override (§8).
//
// Slice 2 adds a "Banned users" section: every ban flows through a report, so a
// still-banned account always has an actioned report we can reuse to lift the ban —
// making unban reliably reachable even after the report left the open queue.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, View } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import {
  listBannedUsers,
  listOpenReports,
  moderateReport,
  type BannedUser,
  type OpenReport,
} from '../../src/lib/moderation';
import { Screen, Text, Avatar, GlassCard, Button, EmptyState, Badge } from '../../src/components/ui';
import { theme } from '../../src/theme';

type Decision = 'dismiss' | 'ban' | 'unban';

export default function AdminReports() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const [reports, setReports] = useState<OpenReport[]>([]);
  const [banned, setBanned] = useState<BannedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [open, bannedUsers] = await Promise.all([listOpenReports(), listBannedUsers()]);
      setReports(open);
      setBanned(bannedUsers);
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'admin') return <Redirect href="/" />;

  async function run(reportId: string, decision: Decision) {
    setBusyId(reportId);
    try {
      await moderateReport({ report_id: reportId, decision });
      await load();
    } catch {
      Alert.alert(t('common.error'), t('moderation.failed'));
    } finally {
      setBusyId(null);
    }
  }

  function confirmReport(report: OpenReport, decision: Decision) {
    const who = report.reported_name ?? t('moderation.thisUser');
    const copy: Record<Decision, { title: string; body: string; cta: string; destructive: boolean }> = {
      dismiss: {
        title: t('moderation.dismissTitle'),
        body: t('moderation.dismissBody'),
        cta: t('moderation.dismiss'),
        destructive: false,
      },
      ban: {
        title: t('moderation.banTitle'),
        body: t('moderation.banBody', { name: who }),
        cta: t('moderation.ban'),
        destructive: true,
      },
      unban: {
        title: t('moderation.unbanTitle'),
        body: t('moderation.unbanBody', { name: who }),
        cta: t('moderation.unban'),
        destructive: false,
      },
    };
    const c = copy[decision];
    Alert.alert(c.title, c.body, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: c.cta, style: c.destructive ? 'destructive' : 'default', onPress: () => run(report.id, decision) },
    ]);
  }

  function confirmUnban(user: BannedUser) {
    const who = user.name ?? t('moderation.thisUser');
    Alert.alert(t('moderation.unbanTitle'), t('moderation.unbanBody', { name: who }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('moderation.unban'), onPress: () => run(user.report_id, 'unban') },
    ]);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const empty = reports.length === 0 && banned.length === 0;

  // Banned-users section (header above the open queue) — only when someone is banned.
  const BannedSection =
    banned.length === 0 ? null : (
      <View style={{ marginBottom: theme.spacing.lg, gap: theme.spacing.sm }}>
        <Text variant="caption" muted style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('moderation.bannedUsersTitle')}
        </Text>
        {banned.map((u) => {
          const busy = busyId === u.report_id;
          return (
            <GlassCard key={u.user_id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Avatar name={u.name ?? '?'} size={40} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{u.name ?? t('moderation.unknownUser')}</Text>
                  <Text variant="caption" muted>
                    {t('moderation.bannedSince', {
                      when: u.banned_at ? new Date(u.banned_at).toLocaleDateString() : '',
                    })}
                  </Text>
                </View>
                <Button title={t('moderation.unban')} onPress={() => confirmUnban(u)} loading={busy} />
              </View>
            </GlassCard>
          );
        })}
      </View>
    );

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <FlatList
        data={reports}
        keyExtractor={(r) => r.id}
        contentContainerStyle={
          empty ? { flexGrow: 1, justifyContent: 'center' } : { padding: theme.spacing.lg, gap: theme.spacing.md }
        }
        ListHeaderComponent={BannedSection}
        ListEmptyComponent={
          empty ? (
            <EmptyState
              icon="shield-checkmark-outline"
              title={t('moderation.emptyTitle')}
              subtitle={t('moderation.emptySub')}
            />
          ) : null
        }
        renderItem={({ item }) => {
          const busy = busyId === item.id;
          return (
            <GlassCard>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Avatar name={item.reported_name ?? '?'} size={44} />
                <View style={{ flex: 1 }}>
                  <Text variant="title">{item.reported_name ?? t('moderation.unknownUser')}</Text>
                  <Text variant="caption" muted>
                    {t('moderation.reportedBy', { name: item.reporter_name ?? t('moderation.unknownUser') })} ·{' '}
                    {new Date(item.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <Badge label={t(`report.reasons.${item.reason}` as const)} tone="secondary" />
              </View>

              {item.reported_banned ? (
                <View style={{ marginTop: theme.spacing.sm }}>
                  <Badge label={t('moderation.alreadyBanned')} tone="danger" solid />
                </View>
              ) : null}

              {/* The reported message — immutable snapshot, not the live thread (§8). */}
              <View
                style={{
                  marginTop: theme.spacing.md,
                  padding: theme.spacing.md,
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text variant="body" style={{ fontStyle: 'italic' }}>
                  {item.reported_body ? `“${item.reported_body}”` : t('moderation.messageUnavailable')}
                </Text>
              </View>

              {item.note ? (
                <Text variant="caption" muted style={{ marginTop: theme.spacing.sm }}>
                  {t('moderation.reporterNote', { note: item.note })}
                </Text>
              ) : null}

              <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.md }}>
                <Button
                  title={t('moderation.dismiss')}
                  variant="ghost"
                  onPress={() => confirmReport(item, 'dismiss')}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                {item.reported_banned ? (
                  <Button
                    title={t('moderation.unban')}
                    onPress={() => confirmReport(item, 'unban')}
                    loading={busy}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <Button
                    title={t('moderation.ban')}
                    onPress={() => confirmReport(item, 'ban')}
                    loading={busy}
                    style={{ flex: 1 }}
                  />
                )}
              </View>
            </GlassCard>
          );
        }}
      />
    </Screen>
  );
}

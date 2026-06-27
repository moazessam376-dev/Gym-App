// Admin → review pending coach applications. Approve flips the applicant to a
// coach; reject closes the request. Both go through the review-coach-application
// Edge Function (the only writer of status / role). RLS lets only an admin read these.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, View } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { listPendingApplications, reviewApplication, type PendingApplication } from '../../src/lib/coach-applications';
import { Screen, Text, Avatar, GlassCard, Button, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function AdminApplications() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const [apps, setApps] = useState<PendingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setApps(await listPendingApplications());
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

  async function decide(app: PendingApplication, approve: boolean) {
    setBusyId(app.id);
    try {
      await reviewApplication(app.id, approve);
      await load();
    } catch {
      Alert.alert(t('common.errorTitle'), t('admin.reviewError'));
    } finally {
      setBusyId(null);
    }
  }

  function confirm(app: PendingApplication, approve: boolean) {
    const who = app.applicant_name ?? t('admin.thisApplicant');
    Alert.alert(
      approve ? t('admin.approveTitle') : t('admin.rejectTitle'),
      approve ? t('admin.approveBody', { who }) : t('admin.rejectBody', { who }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: approve ? t('admin.approve') : t('admin.reject'),
          style: approve ? 'default' : 'destructive',
          onPress: () => decide(app, approve),
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <FlatList
        data={apps}
        keyExtractor={(a) => a.id}
        contentContainerStyle={apps.length === 0 ? { flexGrow: 1, justifyContent: 'center' } : { padding: theme.spacing.lg, gap: theme.spacing.md }}
        ListEmptyComponent={
          <EmptyState icon="clipboard-outline" title={t('admin.noPending')} subtitle={t('admin.noPendingSub')} />
        }
        renderItem={({ item }) => {
          const busy = busyId === item.id;
          return (
            <GlassCard>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Avatar name={item.applicant_name ?? t('admin.applicant')} size={44} />
                <View style={{ flex: 1 }}>
                  <Text variant="title">{item.applicant_name ?? t('admin.unnamedApplicant')}</Text>
                  <Text variant="caption" muted>
                    {t('admin.applied', { date: new Date(item.created_at).toLocaleDateString() })}
                  </Text>
                </View>
              </View>
              {item.message ? (
                <Text variant="body" muted style={{ fontStyle: 'italic', marginTop: theme.spacing.md }}>
                  “{item.message}”
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.md }}>
                <Button title={t('admin.reject')} variant="ghost" onPress={() => confirm(item, false)} disabled={busy} style={{ flex: 1 }} />
                <Button title={t('admin.approve')} onPress={() => confirm(item, true)} loading={busy} style={{ flex: 1 }} />
              </View>
            </GlassCard>
          );
        }}
      />
    </Screen>
  );
}

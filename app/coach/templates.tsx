// Coach → plan templates. Templates are coach-owned plans with no client; the
// coach builds them once, then assigns deep copies to clients.
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { forwardChevron } from '../../src/lib/rtl';
import { listTemplates, type Plan } from '../../src/lib/plans';
import { type PlanType } from '../../src/schemas/plan';
import { Screen, Text, Button, GlassCard, Segmented, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function Templates() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const router = useRouter();
  const [type, setType] = useState<PlanType>('training');
  const [templates, setTemplates] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setTemplates(await listTemplates(type));
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [type]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'coach') return <Redirect href="/" />;

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <FlatList
        data={loading ? [] : templates}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
            <Segmented
              value={type}
              onChange={setType}
              options={[
                { value: 'training', label: t('common.training') },
                { value: 'nutrition', label: t('common.nutrition') },
              ]}
            />
            <Button
              title={t('templates.newPlan')}
              left={<Ionicons name="add" size={18} color={theme.colors.onPrimary} />}
              onPress={() => router.push({ pathname: '/coach/new-plan', params: { type } })}
            />
            <Text variant="label" muted style={{ marginTop: theme.spacing.sm }}>
              {t('templates.yourPlans', { type: t(`common.${type}`) })}
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
          ) : (
            <EmptyState
              icon="documents-outline"
              title={t('templates.emptyTitle')}
              subtitle={t('templates.emptySub')}
            />
          )
        }
        renderItem={({ item }) => (
          <GlassCard onPress={() => router.push({ pathname: '/coach/plan/[id]', params: { id: item.id } })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Text variant="title" style={{ flex: 1 }}>
                {item.title}
              </Text>
              <Ionicons name={forwardChevron()} size={20} color={theme.colors.textMuted} />
            </View>
          </GlassCard>
        )}
      />
    </Screen>
  );
}

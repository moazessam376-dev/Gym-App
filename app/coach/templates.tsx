// Coach → plan templates. Templates are coach-owned plans with no client; the
// coach builds them once, then assigns deep copies to clients.
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { forwardChevron, textStart } from '../../src/lib/rtl';
import { assignPlanToClient, deletePlan, listTemplates, type Plan } from '../../src/lib/plans';
import { type PlanType } from '../../src/schemas/plan';
import { confirmDestructive } from '../../src/lib/confirm';
import { Icon, IconButton, Screen, Text, Button, GlassCard, Segmented, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function Templates() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const router = useRouter();
  // When opened from a client (clientId set), the screen is in "assign mode": tapping a
  // template deep-clones it onto that client instead of opening it for editing.
  const { clientId, clientName } = useLocalSearchParams<{ clientId?: string; clientName?: string }>();
  const assignMode = !!clientId;
  const [type, setType] = useState<PlanType>('training');
  const [templates, setTemplates] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Delete a template (RLS plans_delete already allows the authoring coach). Confirm
  // first, drop it locally on success, and re-sync from the server on any failure.
  async function onDelete(plan: Plan) {
    const ok = await confirmDestructive(
      t('templates.deleteTitle'),
      t('templates.deleteMsg', { title: plan.title }),
      t('common.delete'),
    );
    if (!ok) return;
    try {
      await deletePlan(plan.id);
      setTemplates((prev) => prev.filter((p) => p.id !== plan.id));
    } catch {
      load();
    }
  }

  // Assign-mode tap: clone the template into a new DRAFT for this client, then open it.
  async function onAssign(plan: Plan) {
    if (!clientId || assigning) return;
    setError(null);
    setAssigning(true);
    try {
      const newId = await assignPlanToClient(plan.id, clientId);
      router.replace({ pathname: '/coach/plan/[id]', params: { id: newId } });
    } catch {
      setError(t('assign.error'));
      setAssigning(false);
    }
  }

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
            {assignMode ? (
              <Text variant="body" muted style={textStart}>
                {t('templates.assigningTo', { name: clientName || t('clientDetail.client') })}
              </Text>
            ) : null}
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
              left={<Icon name="add" size={18} color={theme.colors.onPrimary} />}
              onPress={() => router.push({ pathname: '/coach/new-plan', params: { type } })}
            />
            {error ? (
              <Text variant="caption" color="danger">
                {error}
              </Text>
            ) : null}
            {assigning ? <ActivityIndicator color={theme.colors.primary} /> : null}
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
          <GlassCard
            onPress={() =>
              assignMode ? onAssign(item) : router.push({ pathname: '/coach/plan/[id]', params: { id: item.id } })
            }
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Text variant="title" style={{ flex: 1 }}>
                {item.title}
              </Text>
              {assignMode ? null : <IconButton name="trash-outline" onPress={() => onDelete(item)} />}
              <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
            </View>
          </GlassCard>
        )}
      />
    </Screen>
  );
}

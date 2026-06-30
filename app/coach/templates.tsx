// Coach → plan templates. Templates are coach-owned plans with no client; the
// coach builds them once, then assigns deep copies to clients.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { useChrome } from '../../src/lib/chrome';
import { forwardChevron, textStart } from '../../src/lib/rtl';
import { assignPlanToClient, deletePlan, listTemplates, listWeeks, type Plan } from '../../src/lib/plans';
import { type PlanType } from '../../src/schemas/plan';
import {
  adherenceScore,
  getAdherenceOverview,
  getPlanEffectiveness,
  type AdherenceRow,
  type PlanEffectivenessRow,
} from '../../src/lib/analytics';
import { confirmDestructive } from '../../src/lib/confirm';
import {
  Badge,
  Button,
  EmptyState,
  GlassCard,
  Icon,
  IconButton,
  ResponsiveGrid,
  Screen,
  Segmented,
  Text,
} from '../../src/components/ui';
import { theme } from '../../src/theme';

// One boxed stat (desktop card): a colored mono value over a muted uppercase label,
// in its own elevated rounded box. Label arrives already translated, so no t() here.
function StatBox({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.surfaceElevated,
        borderRadius: theme.radii.md,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.sm,
        gap: 2,
      }}
    >
      <Text variant="title" style={[{ fontFamily: theme.fontFamily.monoBold, fontSize: 18, color }, textStart]}>
        {value}
      </Text>
      <Text variant="label" muted style={textStart}>
        {label}
      </Text>
    </View>
  );
}

export default function Templates() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const { active: wide } = useChrome();
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
  // Desktop-only enrichment (real data — see the effects below). Untouched on mobile.
  const [weeksByPlan, setWeeksByPlan] = useState<Record<string, number>>({});
  const [analytics, setAnalytics] = useState<{ eff: PlanEffectivenessRow[]; adh: AdherenceRow[] }>({
    eff: [],
    adh: [],
  });

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

  // ── Desktop-only stat enrichment ────────────────────────────────────────────
  // The mobile FlatList path never reads these, so we skip the queries off-desktop.
  // WEEKS = the template's real week count (training only; nutrition has no weeks).
  useEffect(() => {
    if (!wide) return;
    if (type !== 'training' || templates.length === 0) {
      setWeeksByPlan({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        templates.map(async (p) => {
          try {
            return [p.id, (await listWeeks(p.id)).length] as const;
          } catch {
            return [p.id, 0] as const;
          }
        }),
      );
      if (!cancelled) setWeeksByPlan(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [wide, type, templates]);

  // CLIENTS + ADHER% are joined per template from the coach-fenced analytics RPCs.
  useEffect(() => {
    if (!wide) return;
    let cancelled = false;
    (async () => {
      const [eff, adh] = await Promise.all([
        getPlanEffectiveness().catch(() => [] as PlanEffectivenessRow[]),
        getAdherenceOverview().catch(() => [] as AdherenceRow[]),
      ]);
      if (!cancelled) setAnalytics({ eff, adh });
    })();
    return () => {
      cancelled = true;
    };
  }, [wide]);

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

  // Real, client-side stats for a template card — NO fabrication. CLIENTS = the assigned
  // copies whose lineage (source_plan_id) is this template; ADHER% = the mean roster
  // adherence of those clients (omitted when none of them have adherence data yet).
  function cardStats(planId: string): { clients: number; adherence: number | null } {
    const rows = analytics.eff.filter((r) => r.source_plan_id === planId);
    const clientIds = Array.from(new Set(rows.map((r) => r.client_id)));
    const adhByClient = new Map(analytics.adh.map((r) => [r.client_id, r]));
    const pcts = clientIds
      .map((id) => adhByClient.get(id))
      .filter((r): r is AdherenceRow => r != null)
      .map((r) => adherenceScore(r).overallPct)
      .filter((p): p is number => p != null);
    const adherence = pcts.length ? Math.round(pcts.reduce((a, p) => a + p, 0) / pcts.length) : null;
    return { clients: clientIds.length, adherence };
  }

  function statRow(item: Plan) {
    const { clients, adherence } = cardStats(item.id);
    const boxes: ReactNode[] = [];
    if (item.type === 'training') {
      boxes.push(
        <StatBox
          key="weeks"
          value={String(weeksByPlan[item.id] ?? 0)}
          label={t('webportal.templates.statWeeks')}
          color={theme.colors.primary}
        />,
      );
    }
    boxes.push(
      <StatBox
        key="clients"
        value={String(clients)}
        label={t('webportal.templates.statClients')}
        color={theme.colors.text}
      />,
    );
    if (adherence != null) {
      const ac =
        adherence >= 75 ? theme.colors.success : adherence >= 50 ? theme.colors.warning : theme.colors.danger;
      boxes.push(
        <StatBox key="adher" value={`${adherence}%`} label={t('webportal.templates.statAdherence')} color={ac} />,
      );
    }
    return <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>{boxes}</View>;
  }

  if (role && role !== 'coach') return <Redirect href="/" />;

  // ── Desktop coach portal: header + fluid card grid ─────────────────────────
  if (wide) {
    return (
      <Screen scroll gradient contentStyle={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}>
        {/* Header row: page title (+ assign hint) and the New plan CTA */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: theme.spacing.lg,
          }}
        >
          <View style={{ flex: 1, minWidth: 220, gap: theme.spacing.xs }}>
            <Text variant="h2" style={textStart}>
              {t('webportal.templates.title')}
            </Text>
            <Text variant="body" muted style={textStart}>
              {assignMode
                ? t('templates.assigningTo', { name: clientName || t('clientDetail.client') })
                : t('templates.yourPlans', { type: t(`common.${type}`) })}
            </Text>
          </View>
          <Button
            title={t('templates.newPlan')}
            fullWidth={false}
            left={<Icon name="add" size={18} color={theme.colors.onPrimary} />}
            onPress={() => router.push({ pathname: '/coach/new-plan', params: { type } })}
          />
        </View>

        {/* Training / nutrition switch */}
        <View style={{ maxWidth: 360 }}>
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: 'training', label: t('common.training') },
              { value: 'nutrition', label: t('common.nutrition') },
            ]}
          />
        </View>

        {error ? (
          <Text variant="caption" color="danger" style={textStart}>
            {error}
          </Text>
        ) : null}
        {assigning ? <ActivityIndicator color={theme.colors.primary} /> : null}

        {/* Template cards */}
        {loading ? (
          <ActivityIndicator style={{ marginTop: theme.spacing.xl }} color={theme.colors.primary} />
        ) : templates.length === 0 ? (
          // Center the empty state in the space below the header (it previously sat
          // awkwardly flush under the segmented switch).
          <View
            style={{
              minHeight: 360,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: theme.spacing.xxl,
            }}
          >
            <EmptyState
              icon="documents-outline"
              title={t('templates.emptyTitle')}
              subtitle={t('templates.emptySub')}
            />
          </View>
        ) : (
          <ResponsiveGrid minColWidth={300} gap={theme.spacing.lg}>
            {templates.map((item) => (
              <GlassCard key={item.id} style={{ gap: theme.spacing.md }}>
                {/* Title + TYPE badge (training = cyan-tinted, nutrition = cobalt-tinted) */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}>
                  <Text variant="title" numberOfLines={2} style={[{ flex: 1 }, textStart]}>
                    {item.title}
                  </Text>
                  <Badge
                    label={t(`common.${item.type}`)}
                    tone={item.type === 'nutrition' ? 'secondary' : 'primary'}
                  />
                </View>

                {/* Short meta line: plan status + last updated */}
                <Text variant="caption" muted style={textStart}>
                  {`${t(`planStatus.${item.status}`)} · ${t('webportal.templates.updated')} ${new Date(
                    item.updated_at,
                  ).toLocaleDateString()}`}
                </Text>

                {/* Boxed stats: WEEKS / CLIENTS / ADHER.% (real data; a box is omitted, never faked) */}
                {statRow(item)}

                {/* Actions: Edit (outline) + Assign (cyan) in assign mode, else Edit + delete */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    marginTop: theme.spacing.xs,
                  }}
                >
                  <Button
                    title={t('common.edit')}
                    variant="secondary"
                    left={<Icon name="create-outline" size={16} color={theme.colors.text} />}
                    onPress={() => router.push({ pathname: '/coach/plan/[id]', params: { id: item.id } })}
                    style={{ flex: 1 }}
                  />
                  {assignMode ? (
                    <Button
                      title={t('webportal.templates.assign')}
                      left={<Icon name="person-add" size={16} color={theme.colors.onPrimary} />}
                      onPress={() => onAssign(item)}
                      disabled={assigning}
                      style={{ flex: 1 }}
                    />
                  ) : (
                    <IconButton name="trash-outline" onPress={() => onDelete(item)} />
                  )}
                </View>
              </GlassCard>
            ))}
          </ResponsiveGrid>
        )}
      </Screen>
    );
  }

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

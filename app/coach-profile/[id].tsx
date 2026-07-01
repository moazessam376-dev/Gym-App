// Public coach portfolio (Phase 19). Reads ONLY the field-allowlist RPCs — never the raw
// tables — so a private coach returns nothing and no sensitive field is reachable. Shows
// avatar, bio, specialties, certifications, achievements, and the AGGREGATE "goals this
// coach helps achieve" highlights (counts only, never a client identity). Authenticated
// members only in V1.
import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { textStart } from '../../src/lib/rtl';
import { useAuth } from '../../src/lib/auth-context';
import { usePublicCoachProfile, useCoachPublicHighlights, useCoachTransformations } from '../../src/lib/queries/profiles';
import { useMyCoach } from '../../src/lib/queries/home';
import { useMyCoachRequests } from '../../src/lib/queries/coach-requests';
import { createCoachRequest, cancelCoachRequest, DUPLICATE_PENDING_REQUEST } from '../../src/lib/coach-requests';
import { queryClient } from '../../src/lib/query';
import type { CoachHighlight } from '../../src/lib/public-profiles';
import { ProfileAvatar } from '../../src/components/ProfileAvatar';
import { ShareableTransformationCard } from '../../src/components/ShareableTransformationCard';
import { RequestCoachSheet } from '../../src/components/RequestCoachSheet';
import { Icon, Screen, Text, GlassCard, Chip, Badge, EmptyState, Button, useToast } from '../../src/components/ui';
import { theme } from '../../src/theme';

const medianLabel = (m: number | null) => (m == null ? null : `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(1)}`);

function label(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function HighlightRow({ h }: { h: CoachHighlight }) {
  const { t } = useTranslation();
  const goal = t(`goals.${h.primary_goal}`, { defaultValue: label(h.primary_goal) });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" style={textStart}>
          {goal}
        </Text>
        <Text variant="caption" muted style={textStart}>
          {t('publicProfile.highlightClients', { count: h.client_count })}
          {h.median_progress != null ? ` · ${medianLabel(h.median_progress)} ${t('coachProfile.medianOutcome')}` : ''}
        </Text>
      </View>
      {h.with_progress > 0 ? (
        <Text variant="bodyStrong" color={theme.colors.success}>
          {t('publicProfile.highlightImproved', { improved: h.improved, withProgress: h.with_progress })}
        </Text>
      ) : null}
    </View>
  );
}

export default function CoachProfileScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { role, session } = useAuth();
  const userId = session?.user?.id;
  const toast = useToast();
  const profileQ = usePublicCoachProfile(id);
  const highlightsQ = useCoachPublicHighlights(id);
  const transformationsQ = useCoachTransformations(id);

  // "Request this coach" funnel (G2) — only for a signed-in client. We need their coach
  // status (unassigned can request) and any existing request to THIS coach.
  const isClient = role === 'client';
  const myCoachQ = useMyCoach(isClient ? userId : undefined);
  const myRequestsQ = useMyCoachRequests(isClient);
  const pendingToThisCoach = (myRequestsQ.data ?? []).find((r) => r.coach_id === id && r.status === 'pending') ?? null;
  const unassigned = isClient && !myCoachQ.isLoading && !myCoachQ.data;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const onRequest = async (note: string) => {
    if (!id) return;
    setBusy(true);
    try {
      await createCoachRequest(id, note);
      setSheetOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['my-coach-requests'] });
      toast.show(t('coachRequest.sent'));
    } catch (e) {
      const msg = e instanceof Error && e.message === DUPLICATE_PENDING_REQUEST
        ? t('coachRequest.alreadyRequested')
        : t('common.error');
      toast.show(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!pendingToThisCoach) return;
    setBusy(true);
    try {
      await cancelCoachRequest(pendingToThisCoach.id);
      await queryClient.invalidateQueries({ queryKey: ['my-coach-requests'] });
      toast.show(t('coachRequest.cancelled'));
    } catch {
      toast.show(t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const header = <Stack.Screen options={{ title: t('publicProfile.coachTitle') }} />;

  if (profileQ.isLoading) {
    return (
      <Screen gradient>
        {header}
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} />
      </Screen>
    );
  }

  const p = profileQ.data;
  if (!p) {
    return (
      <Screen gradient>
        {header}
        <EmptyState
          icon="person-outline"
          title={t('publicProfile.notPublicTitle')}
          subtitle={t('publicProfile.notPublicSub')}
        />
      </Screen>
    );
  }

  const highlights = highlightsQ.data ?? [];

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
      {header}

      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <ProfileAvatar name={p.full_name} avatarMediaId={p.avatar_media_id} size={104} />
        <Text variant="h2">{p.full_name ?? ''}</Text>
        {p.handle ? (
          <Text variant="caption" muted>
            @{p.handle}
          </Text>
        ) : null}
        {p.years_experience != null ? (
          <Text variant="caption" muted>
            {t('publicProfile.yearsExperience', { count: p.years_experience })}
          </Text>
        ) : null}
        <Badge
          label={p.accepting_clients ? t('coachProfile.acceptingClients') : t('coachProfile.fullRoster')}
          tone={p.accepting_clients ? 'success' : 'warning'}
          solid
        />
      </View>

      {/* Outcome strip — real numbers (active roster + median goal-progress), not vanity %. */}
      <GlassCard style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text variant="bodyStrong">{p.active_roster_count}</Text>
          <Text variant="caption" muted>
            {t('coachProfile.activeClientsLabel')}
          </Text>
        </View>
        {p.median_goal_progress != null ? (
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text variant="bodyStrong" color={theme.colors.primary}>
              {medianLabel(p.median_goal_progress)}
            </Text>
            <Text variant="caption" muted>
              {t('coachProfile.medianOutcome')}
            </Text>
          </View>
        ) : null}
      </GlassCard>

      {/* Transformations showcase — branded before/after cards (the conversion driver). */}
      {(transformationsQ.data ?? []).length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('coachProfile.transformations')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.md }}>
            {(transformationsQ.data ?? []).map((tr) => (
              <ShareableTransformationCard key={tr.transformation_id} item={tr} coachName={p.full_name} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Request-a-coach CTA — only for an unassigned signed-in client (G2). */}
      {isClient ? (
        pendingToThisCoach ? (
          <GlassCard style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <Icon name="check-circle" size={18} color={theme.colors.success} />
              <Text variant="bodyStrong" style={[textStart, { flex: 1 }]}>
                {t('coachRequest.requested')}
              </Text>
            </View>
            <Button title={t('coachRequest.cancel')} variant="ghost" onPress={onCancel} loading={busy} />
          </GlassCard>
        ) : unassigned ? (
          <Button title={t('coachRequest.cta')} onPress={() => setSheetOpen(true)} />
        ) : null
      ) : null}

      {p.bio ? (
        <GlassCard>
          <Text variant="body" style={textStart}>
            {p.bio}
          </Text>
        </GlassCard>
      ) : null}

      {p.coaching_philosophy ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('coachProfile.philosophy')}
          </Text>
          <GlassCard>
            <Text variant="body" style={textStart}>
              {p.coaching_philosophy}
            </Text>
          </GlassCard>
        </View>
      ) : null}

      {p.specialties.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('publicProfile.specialties')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {p.specialties.map((s) => (
              <Chip key={s} label={t(`specialty.${s}`, { defaultValue: label(s) })} />
            ))}
          </View>
        </View>
      ) : null}

      {p.certifications ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('publicProfile.certifications')}
          </Text>
          <GlassCard>
            <Text variant="body" style={textStart}>
              {p.certifications}
            </Text>
          </GlassCard>
        </View>
      ) : null}

      {p.achievements.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('publicProfile.achievements')}
          </Text>
          <GlassCard style={{ gap: theme.spacing.md }}>
            {p.achievements.map((a, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Icon name="trophy-outline" size={18} color={theme.colors.primary} />
                <Text variant="body" style={[{ flex: 1 }, textStart]}>
                  {a}
                </Text>
              </View>
            ))}
          </GlassCard>
        </View>
      ) : null}

      {/* Aggregate, anonymized proof — counts only, never a client identity. */}
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" muted style={textStart}>
          {t('publicProfile.highlightsTitle')}
        </Text>
        <Text variant="caption" muted style={textStart}>
          {t('publicProfile.highlightsSub')}
        </Text>
        <GlassCard style={{ gap: theme.spacing.lg }}>
          {highlights.length > 0 ? (
            highlights.map((h) => <HighlightRow key={h.primary_goal} h={h} />)
          ) : (
            <Text variant="caption" muted style={textStart}>
              {t('publicProfile.noHighlights')}
            </Text>
          )}
        </GlassCard>
      </View>

      <RequestCoachSheet
        visible={sheetOpen}
        busy={busy}
        coachName={p.full_name}
        onSubmit={onRequest}
        onClose={() => setSheetOpen(false)}
      />
    </Screen>
  );
}

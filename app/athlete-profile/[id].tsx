// Public athlete profile (Phase 19 → enriched in E2/0075). Reads get_public_athlete_profile,
// a field-allowlist + consent-gated RPC: identity + activity + PR gallery + trophies always
// show on a public profile; the body-transformation block (timeline chart, deltas, goal-
// progress bar, FFMI tier) only appears when the athlete opted in to share_body_metrics_publicly.
// The sensitive raw fields (birth date, injuries, height, sex) are never selected by the RPC.
import { View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { textStart } from '../../src/lib/rtl';
import { usePublicAthleteProfile } from '../../src/lib/queries/profiles';
import { usePublicAchievements } from '../../src/lib/queries/achievements';
import { ProfileAvatar } from '../../src/components/ProfileAvatar';
import { TrophyGrid } from '../../src/components/TrophyGrid';
import { Icon, Screen, Text, GlassCard, Badge, TierChip, Sparkline, EmptyState, ScreenLoader } from '../../src/components/ui';
import { theme } from '../../src/theme';

const kg = (grams?: number | null) => (grams == null ? null : Math.round((grams / 1000) * 10) / 10);

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export default function AthleteProfileScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profileQ = usePublicAthleteProfile(id);
  const trophiesQ = usePublicAchievements(id);

  const header = <Stack.Screen options={{ title: t('publicProfile.athleteTitle') }} />;

  if (profileQ.isLoading) {
    return (
      <Screen gradient>
        {header}
        <ScreenLoader />
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

  // Transformation deltas (only present when shared). Body fat: positive delta = lost (good).
  const bfPct = p.body_fat_delta_bp == null ? null : Math.round((p.body_fat_delta_bp / 100) * 10) / 10;
  const lmKg = p.lean_mass_delta_grams == null ? null : Math.round((p.lean_mass_delta_grams / 1000) * 10) / 10;
  const weightSeries = (p.body_metrics_series ?? [])
    .map((s) => kg(s.weight_grams))
    .filter((v): v is number => v != null);

  // Goal-progress bar: how far latest weight has moved from baseline toward target.
  const baselineWeight = kg(p.body_metrics_series?.[0]?.weight_grams);
  const targetKg = kg(p.target_weight_grams);
  const latestKg = kg(p.latest_weight_grams);
  const goalFrac =
    baselineWeight != null && targetKg != null && latestKg != null && baselineWeight !== targetKg
      ? clamp01((baselineWeight - latestKg) / (baselineWeight - targetKg))
      : null;

  const showTransformation = p.share_body_metrics && p.has_transformation && weightSeries.length >= 2;
  const showGoalBar = p.share_body_metrics && targetKg != null && latestKg != null;

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
      {header}

      {/* Header */}
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <ProfileAvatar name={p.full_name} avatarMediaId={p.avatar_media_id} size={104} />
        <Text variant="h2">{p.full_name ?? ''}</Text>
        {p.handle ? (
          <Text variant="caption" muted>
            @{p.handle}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
          {p.primary_goal ? (
            <Badge label={t(`goals.${p.primary_goal}`, { defaultValue: p.primary_goal })} tone="secondary" solid />
          ) : null}
          {p.share_body_metrics && p.ffmi_tier ? (
            <TierChip tier={p.ffmi_tier} label={t(`leaderboards.tier.${p.ffmi_tier}`)} />
          ) : null}
        </View>
      </View>

      {/* Activity strip */}
      <GlassCard style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="flame" size={16} color={theme.colors.primary} />
            <Text variant="bodyStrong">{p.current_streak}</Text>
          </View>
          <Text variant="caption" muted>
            {t('athleteProfile.streak')}
          </Text>
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text variant="bodyStrong">{p.workouts_last_30d}</Text>
          <Text variant="caption" muted>
            {t('athleteProfile.last30')}
          </Text>
        </View>
        {p.training_days != null ? (
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text variant="bodyStrong">{t('athleteProfile.trainingPerWeek', { count: p.training_days })}</Text>
            <Text variant="caption" muted>
              {t('athleteProfile.trainingDaysLabel')}
            </Text>
          </View>
        ) : null}
      </GlassCard>

      {/* Goal-progress bar */}
      {showGoalBar ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('athleteProfile.goalProgress')}
          </Text>
          <GlassCard style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" muted>
                {t('athleteProfile.current')}: {latestKg} kg
              </Text>
              <Text variant="caption" muted>
                {t('athleteProfile.target')}: {targetKg} kg
              </Text>
            </View>
            {goalFrac != null ? (
              <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.border, overflow: 'hidden' }}>
                <View
                  style={{
                    width: `${Math.round(goalFrac * 100)}%`,
                    height: '100%',
                    borderRadius: 4,
                    backgroundColor: theme.colors.primary,
                  }}
                />
              </View>
            ) : null}
          </GlassCard>
        </View>
      ) : null}

      {/* Transformation timeline */}
      {showTransformation ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('athleteProfile.transformation')}
          </Text>
          <GlassCard style={{ gap: theme.spacing.md }}>
            <Sparkline data={weightSeries} width={260} height={56} />
            <View style={{ flexDirection: 'row', gap: theme.spacing.lg, flexWrap: 'wrap' }}>
              {bfPct != null ? (
                <Text variant="bodyStrong" color={bfPct >= 0 ? theme.colors.success : theme.colors.danger}>
                  {bfPct >= 0 ? '−' : '+'}
                  {Math.abs(bfPct)}% {t('athleteProfile.bodyFat')}
                </Text>
              ) : null}
              {lmKg != null ? (
                <Text variant="bodyStrong" color={lmKg >= 0 ? theme.colors.success : theme.colors.danger}>
                  {lmKg >= 0 ? '+' : '−'}
                  {Math.abs(lmKg)} kg {t('athleteProfile.leanMass')}
                </Text>
              ) : null}
            </View>
          </GlassCard>
        </View>
      ) : null}

      {/* Trophy case */}
      {trophiesQ.data ? <TrophyGrid earned={trophiesQ.data} /> : null}

      {/* PR gallery */}
      {p.top_prs.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('athleteProfile.prGallery')}
          </Text>
          <GlassCard style={{ gap: theme.spacing.md }}>
            {p.top_prs.map((pr, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Icon name="barbell-outline" size={18} color={theme.colors.primary} />
                <Text variant="body" style={[{ flex: 1 }, textStart]}>
                  {pr.exercise_name}
                </Text>
                <Text variant="bodyStrong">
                  {pr.best_load_grams ? `${kg(pr.best_load_grams)} kg` : `${pr.best_reps ?? 0} ${t('athleteProfile.repsShort')}`}
                </Text>
              </View>
            ))}
          </GlassCard>
        </View>
      ) : null}

      {/* Self-assigned notes */}
      {p.public_achievements.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('publicProfile.achievements')}
          </Text>
          <GlassCard style={{ gap: theme.spacing.md }}>
            {p.public_achievements.map((a, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Icon name="ribbon-outline" size={18} color={theme.colors.primary} />
                <Text variant="body" style={[{ flex: 1 }, textStart]}>
                  {a}
                </Text>
              </View>
            ))}
          </GlassCard>
        </View>
      ) : null}

      {/* Coach chip */}
      {p.coach_id ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('athleteProfile.trainingWith')}
          </Text>
          <GlassCard style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <ProfileAvatar name={p.coach_name} avatarMediaId={p.coach_avatar_media_id} size={40} />
            <Text variant="bodyStrong" style={[{ flex: 1 }, textStart]}>
              {p.coach_name ?? ''}
            </Text>
          </GlassCard>
        </View>
      ) : null}
    </Screen>
  );
}

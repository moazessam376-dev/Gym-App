// Public coach portfolio (Phase 19). Reads ONLY the field-allowlist RPCs — never the raw
// tables — so a private coach returns nothing and no sensitive field is reachable. Shows
// avatar, bio, specialties, certifications, achievements, and the AGGREGATE "goals this
// coach helps achieve" highlights (counts only, never a client identity). Authenticated
// members only in V1.
import { ActivityIndicator, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { textStart } from '../../src/lib/rtl';
import { usePublicCoachProfile, useCoachPublicHighlights } from '../../src/lib/queries/profiles';
import type { CoachHighlight } from '../../src/lib/public-profiles';
import { ProfileAvatar } from '../../src/components/ProfileAvatar';
import { Icon, Screen, Text, GlassCard, Chip, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

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
  const profileQ = usePublicCoachProfile(id);
  const highlightsQ = useCoachPublicHighlights(id);

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
        {p.years_experience != null ? (
          <Text variant="caption" muted>
            {t('publicProfile.yearsExperience', { count: p.years_experience })}
          </Text>
        ) : null}
      </View>

      {p.bio ? (
        <GlassCard>
          <Text variant="body" style={textStart}>
            {p.bio}
          </Text>
        </GlassCard>
      ) : null}

      {p.specialties.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('publicProfile.specialties')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {p.specialties.map((s) => (
              <Chip key={s} label={label(s)} />
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
    </Screen>
  );
}

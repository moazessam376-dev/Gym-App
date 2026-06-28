// Public athlete profile (Phase 19). Reads ONLY get_public_athlete_profile — a minimal
// allowlist (name, avatar, goal, public achievements). The sensitive fields (birth date,
// height, sex, injuries, coach) are never selected by the RPC, so they cannot appear here
// regardless of the client. A private/missing profile renders the not-available state.
import { ActivityIndicator, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { textStart } from '../../src/lib/rtl';
import { usePublicAthleteProfile } from '../../src/lib/queries/profiles';
import { ProfileAvatar } from '../../src/components/ProfileAvatar';
import { Icon, Screen, Text, GlassCard, Badge, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function AthleteProfileScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profileQ = usePublicAthleteProfile(id);

  const header = <Stack.Screen options={{ title: t('publicProfile.athleteTitle') }} />;

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
        {p.primary_goal ? (
          <Badge label={t(`goals.${p.primary_goal}`, { defaultValue: p.primary_goal })} tone="secondary" solid />
        ) : null}
      </View>

      {p.public_achievements.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('publicProfile.achievements')}
          </Text>
          <GlassCard style={{ gap: theme.spacing.md }}>
            {p.public_achievements.map((a, i) => (
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
    </Screen>
  );
}

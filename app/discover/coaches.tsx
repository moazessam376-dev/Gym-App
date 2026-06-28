// Discover public coaches (Phase 19) — the browse surface that seeds the future
// find-a-coach funnel. Lists coaches who opted their profile public (via the
// list_public_coaches allowlist RPC), with an optional case-insensitive specialty
// filter. Tapping a card opens the public coach portfolio. Authenticated members only.
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { forwardChevron, textStart } from '../../src/lib/rtl';
import { usePublicCoaches } from '../../src/lib/queries/profiles';
import type { PublicCoachListItem } from '../../src/lib/public-profiles';
import { ProfileAvatar } from '../../src/components/ProfileAvatar';
import { Icon, Screen, Text, Input, GlassCard, Chip, Badge, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

/** Prettify a raw specialty value as a last-resort fallback (the dictionary wins). */
function label(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function CoachCard({ coach, onPress }: { coach: PublicCoachListItem; onPress: () => void }) {
  const { t } = useTranslation();
  const improved = coach.improved_clients ?? 0;
  const tracked = coach.tracked_clients ?? 0;
  return (
    <GlassCard onPress={onPress} style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <ProfileAvatar name={coach.full_name} avatarMediaId={coach.avatar_media_id} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Text variant="bodyStrong" style={[textStart, { flexShrink: 1 }]} numberOfLines={1}>
              {coach.full_name ?? ''}
            </Text>
            {/* Verified = has at least one client who improved on verified readings (U-4). */}
            {improved > 0 ? <Badge label={t('discover.verified')} tone="success" solid /> : null}
          </View>
          {coach.handle ? (
            <Text variant="caption" muted style={textStart}>
              @{coach.handle}
            </Text>
          ) : null}
          {coach.years_experience != null ? (
            <Text variant="caption" muted style={textStart}>
              {t('discover.yearsExp', { count: coach.years_experience })}
            </Text>
          ) : null}
        </View>
        <Icon name={forwardChevron()} size={18} color={theme.colors.textMuted} />
      </View>
      {coach.bio ? (
        <Text variant="caption" muted style={textStart} numberOfLines={2}>
          {coach.bio}
        </Text>
      ) : null}
      {/* Outcome proof — turns the directory into a "specialist list" (U-4). */}
      {tracked > 0 ? (
        <Text variant="caption" color="primary" style={textStart}>
          {t('discover.outcome', { tracked, improved })}
        </Text>
      ) : null}
      {coach.specialties.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {coach.specialties.slice(0, 4).map((s) => (
            <Chip key={s} label={t(`specialty.${s}`, { defaultValue: label(s) })} />
          ))}
        </View>
      ) : null}
    </GlassCard>
  );
}

export default function DiscoverCoaches() {
  const { t } = useTranslation();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const coachesQ = usePublicCoaches(search.trim() || null);
  const coaches = coachesQ.data ?? [];

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <Stack.Screen options={{ title: t('discover.title') }} />
      <FlatList
        data={coachesQ.isLoading ? [] : coaches}
        keyExtractor={(c) => c.coach_id}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
            <Text variant="body" muted style={textStart}>
              {t('discover.subtitle')}
            </Text>
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder={t('discover.searchPlaceholder')}
              autoCapitalize="none"
            />
          </View>
        }
        ListEmptyComponent={
          coachesQ.isLoading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
          ) : coachesQ.isError ? (
            <EmptyState icon="cloud-offline-outline" title={t('discover.loadError')} subtitle={t('common.retry')} />
          ) : (
            <EmptyState
              icon="search-outline"
              title={t('discover.emptyTitle')}
              subtitle={t('discover.emptySub')}
            />
          )
        }
        renderItem={({ item }) => (
          <CoachCard coach={item} onPress={() => router.push(`/coach-profile/${item.coach_id}`)} />
        )}
      />
    </Screen>
  );
}

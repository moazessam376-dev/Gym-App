// Public leaderboards (Phase 20) — two opt-in, anti-cheat boards browsable by any
// authenticated member: Top Athletes (a tiered physique league, FFMI-ranked from each
// athlete's latest COACH-VERIFIED InBody, split into men's/women's) and Top Coaches
// (ranked by aggregate verified client outcomes — counts only, no client ids). The data
// comes from the field-allowlist RPCs in 0045 (the raw tables get no new read path); the
// FFMI→tier mapping is computed app-side (src/lib/leagues.ts). Tapping a row opens the
// public profile.
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { textStart } from '../../src/lib/rtl';
import { useTopAthletes, useTopCoaches, useMyLeagueStanding } from '../../src/lib/queries/leaderboards';
import { useRefreshOnFocus } from '../../src/lib/queries/home';
import { ffmiTier, type TierId } from '../../src/lib/leagues';
import type { AthleteBoardRow, CoachBoardRow } from '../../src/lib/leaderboards';
import type { Sex } from '../../src/schemas/athlete-profile';
import { ProfileAvatar } from '../../src/components/ProfileAvatar';
import { Screen, Text, GlassCard, Segmented, EmptyState, TierChip } from '../../src/components/ui';
import { theme } from '../../src/theme';

type Board = 'athletes' | 'coaches';

function goalLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Tier pill (Bronze…Apex) — tier-colored mono on a tier-soft fill (brand chip). */
function TierBadge({ tier }: { tier: TierId }) {
  const { t } = useTranslation();
  return <TierChip tier={tier} label={t(`leaderboards.tier.${tier}`)} />;
}

/** Mono rank — cyan for the top three, muted otherwise (brand rule: numbers are mono). */
function RankNumber({ rank }: { rank: number }) {
  return (
    <View style={{ width: 28, alignItems: 'center' }}>
      <Text
        color={rank <= 3 ? theme.colors.primary : theme.colors.textMuted}
        style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 16 }}
      >
        {rank}
      </Text>
    </View>
  );
}

function AthleteRow({ row, rank, sex, onPress }: { row: AthleteBoardRow; rank: number; sex: Sex; onPress: () => void }) {
  const { t } = useTranslation();
  const tier = ffmiTier(row.ffmi, sex);
  return (
    <GlassCard onPress={onPress} style={rank === 1 ? { borderColor: theme.colors.primary } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <RankNumber rank={rank} />
        <ProfileAvatar name={row.full_name} avatarMediaId={row.avatar_media_id} size={44} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title" style={textStart}>
            {row.full_name ?? ''}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <TierBadge tier={tier} />
            {row.primary_goal ? (
              <Text variant="caption" muted>
                {goalLabel(row.primary_goal)}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="display" color={theme.colors.primary} style={{ fontSize: 22, lineHeight: 26 }}>
            {row.ffmi.toFixed(1)}
          </Text>
          <Text variant="label" muted>
            {t('leaderboards.ffmi')}
          </Text>
        </View>
      </View>
    </GlassCard>
  );
}

function CoachRow({ row, rank, onPress }: { row: CoachBoardRow; rank: number; onPress: () => void }) {
  const { t } = useTranslation();
  const rate = row.tracked_clients > 0 ? Math.round((row.improved_clients / row.tracked_clients) * 100) : 0;
  return (
    <GlassCard onPress={onPress} style={rank === 1 ? { borderColor: theme.colors.primary } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <RankNumber rank={rank} />
        <ProfileAvatar name={row.full_name} avatarMediaId={row.avatar_media_id} size={44} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title" style={textStart}>
            {row.full_name ?? ''}
          </Text>
          <Text variant="caption" muted style={textStart}>
            {t('leaderboards.clientsImproved', {
              improved: row.improved_clients,
              tracked: row.tracked_clients,
            })}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="display" color={theme.colors.success} style={{ fontSize: 22, lineHeight: 26 }}>
            {rate}%
          </Text>
          <Text variant="label" muted>
            {t('leaderboards.successRate')}
          </Text>
        </View>
      </View>
    </GlassCard>
  );
}

export default function Leaderboards() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const standingQ = useMyLeagueStanding(userId);
  const mySex = standingQ.data?.sex ?? null;

  const [board, setBoard] = useState<Board>('athletes');
  const [sex, setSex] = useState<Sex>('male');
  // Default the sex segment to the viewer's own sex once it loads (without overriding a
  // manual choice — only applies while the user hasn't touched the toggle).
  const [sexTouched, setSexTouched] = useState(false);
  const effectiveSex: Sex = !sexTouched && mySex ? mySex : sex;

  const athletesQ = useTopAthletes(effectiveSex);
  const coachesQ = useTopCoaches();
  useRefreshOnFocus(board === 'athletes' ? athletesQ.refetch : coachesQ.refetch);

  const activeQ = board === 'athletes' ? athletesQ : coachesQ;
  const athletes = athletesQ.data ?? [];
  const coaches = coachesQ.data ?? [];

  const boardOptions = useMemo(
    () => [
      { value: 'athletes' as const, label: t('leaderboards.athletes') },
      { value: 'coaches' as const, label: t('leaderboards.coaches') },
    ],
    [t],
  );
  const sexOptions = useMemo(
    () => [
      { value: 'male' as const, label: t('leaderboards.men') },
      { value: 'female' as const, label: t('leaderboards.women') },
    ],
    [t],
  );

  const header = (
    <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
      <Text variant="body" muted style={textStart}>
        {t('leaderboards.subtitle')}
      </Text>
      <Segmented options={boardOptions} value={board} onChange={setBoard} />
      {board === 'athletes' ? (
        <Segmented
          options={sexOptions}
          value={effectiveSex}
          onChange={(v) => {
            setSexTouched(true);
            setSex(v);
          }}
        />
      ) : null}
    </View>
  );

  const empty = activeQ.isLoading ? (
    <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
  ) : activeQ.isError ? (
    <EmptyState icon="cloud-offline-outline" title={t('leaderboards.loadError')} subtitle={t('common.retry')} />
  ) : (
    <EmptyState icon="trophy-outline" title={t('leaderboards.emptyTitle')} subtitle={t('leaderboards.emptySub')} />
  );

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <Stack.Screen options={{ title: t('leaderboards.title') }} />
      {board === 'athletes' ? (
        <FlatList
          data={athletesQ.isLoading ? [] : athletes}
          keyExtractor={(r) => r.athlete_id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md }}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderItem={({ item, index }) => (
            <AthleteRow
              row={item}
              rank={index + 1}
              sex={effectiveSex}
              onPress={() => router.push(`/athlete-profile/${item.athlete_id}`)}
            />
          )}
        />
      ) : (
        <FlatList
          data={coachesQ.isLoading ? [] : coaches}
          keyExtractor={(r) => r.coach_id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md }}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderItem={({ item, index }) => (
            <CoachRow row={item} rank={index + 1} onPress={() => router.push(`/coach-profile/${item.coach_id}`)} />
          )}
        />
      )}
    </Screen>
  );
}

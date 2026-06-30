// Public leaderboards (Phase 20 + Slice G1) — two opt-in, anti-cheat boards browsable by
// any authenticated member: Top Athletes (a tiered physique league, FFMI-ranked from each
// athlete's latest COACH-VERIFIED InBody, split into men's/women's) and Top Coaches
// (ranked by aggregate verified client outcomes — counts only, no client ids). The data
// comes from the field-allowlist RPCs in 0045/0052 (the raw tables get no new read path);
// the FFMI→tier mapping is computed app-side (src/lib/leagues.ts). Tapping a row opens the
// public profile. G1 adds: a period toggle (month/quarter/all-time), a pinned "You · #rank"
// card (exact rank via the 0052 self-rank RPC), and an FFMI explainer sheet.
//
// Shared body used by BOTH the standalone /leaderboards route (client trophy → stack header
// + back) and the coach's Leaderboard bottom tab (app/(tabs)/board.tsx → `inTab` renders an
// in-screen title + top safe-area, since tabs have no stack header).
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { useChrome } from '@/lib/chrome';
import { textStart } from '@/lib/rtl';
import {
  useTopAthletes,
  useTopCoaches,
  useMyLeagueStanding,
  useMyAthleteRank,
  useMyCoachRank,
} from '@/lib/queries/leaderboards';
import { useRefreshOnFocus } from '@/lib/queries/home';
import { ffmiTier, type TierId, type LeagueStanding } from '@/lib/leagues';
import type { AthleteBoardRow, CoachBoardRow, LeaderboardPeriod, MyAthleteRank, MyCoachRank } from '@/lib/leaderboards';
import type { Sex } from '@/schemas/athlete-profile';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { FfmiInfoSheet } from '@/components/FfmiInfoSheet';
import { Screen, Text, GlassCard, Card, Segmented, EmptyState, TierChip, RankCrest, Icon } from '@/components/ui';
import { theme } from '@/theme';

type Board = 'athletes' | 'coaches';

/** Signed median score → "+1.5" / "−0.8" / "—" (the coach board rank key, brand cyan). */
function medianLabel(m: number | null): string {
  if (m == null) return '—';
  return `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(1)}`;
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

/**
 * The viewer's own standing, pinned above the board. Shows the exact rank ("You · #N of M")
 * when they qualify, otherwise a nudge to log a verified reading or opt in. Only rendered on
 * the athletes board for the viewer's own sex segment.
 */
function MyStandingCard({
  rank,
  standing,
  sex,
  onManage,
}: {
  rank: MyAthleteRank | null;
  standing: LeagueStanding | undefined;
  sex: Sex;
  onManage: () => void;
}) {
  const { t } = useTranslation();

  if (rank) {
    const tier = ffmiTier(rank.ffmi, sex);
    return (
      <GlassCard glowColor={theme.colors.primary}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <View style={{ width: 28, alignItems: 'center' }}>
            <Text color={theme.colors.primary} style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 16 }}>
              {rank.rank}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title" style={textStart}>
              {t('leaderboards.you')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <TierBadge tier={tier} />
              <Text variant="caption" muted>
                {t('leaderboards.rankOf', { rank: rank.rank, total: rank.total })}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="display" color={theme.colors.primary} style={{ fontSize: 22, lineHeight: 26 }}>
              {rank.ffmi.toFixed(1)}
            </Text>
            <Text variant="label" muted>
              {t('leaderboards.ffmi')}
            </Text>
          </View>
        </View>
      </GlassCard>
    );
  }

  // No qualifying standing → an actionable nudge.
  const needsReading = !standing?.hasVerifiedReading;
  return (
    <Pressable onPress={onManage} accessibilityRole="button">
      <GlassCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Icon name="trophy-outline" size={22} color={theme.colors.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" style={textStart}>
              {t('leaderboards.you')}
            </Text>
            <Text variant="caption" muted style={textStart}>
              {needsReading ? t('leaderboards.nudgeReading') : t('leaderboards.nudgeOptIn')}
            </Text>
          </View>
          {!needsReading ? <Icon name="chevron-forward" size={18} color={theme.colors.textMuted} /> : null}
        </View>
      </GlassCard>
    </Pressable>
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
          {row.handle ? (
            <Text variant="caption" muted style={textStart}>
              @{row.handle}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <TierBadge tier={tier} />
            {row.primary_goal ? (
              <Text variant="caption" muted>
                {t(`goals.${row.primary_goal}`, { defaultValue: row.primary_goal })}
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
        {/* Rank key = median goal-progress (real magnitude), cyan-on-brand — not the old
            success-green "% improved" vanity number. */}
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="display" color={theme.colors.primary} style={{ fontSize: 22, lineHeight: 26 }}>
            {medianLabel(row.median_goal_progress)}
          </Text>
          <Text variant="label" muted>
            {t('leaderboards.medianProgress')}
          </Text>
        </View>
      </View>
    </GlassCard>
  );
}

// ── Desktop (coach web shell) ranked TABLE — header row + flex-weighted data rows,
// mirroring RosterMatrix's wide mode. Module-scope components → their OWN useTranslation.
// Reuses the exact tier/FFMI helpers + board data as the mobile cards; no new query.

const ATHLETE_COLS = { rank: 0.5, athlete: 2.8, tier: 1.7, result: 1 } as const;
const COACH_COLS = { rank: 0.5, coach: 3.5, result: 1.3 } as const;

/** A desktop table header label cell (RTL-safe alignment via `align`). */
function HeadCell({ flex, align, children }: { flex: number; align: 'start' | 'center' | 'end'; children: ReactNode }) {
  return (
    <View style={{ flex, alignItems: align === 'center' ? 'center' : align === 'end' ? 'flex-end' : undefined, paddingHorizontal: theme.spacing.sm }}>
      <Text variant="label" muted style={align === 'start' ? textStart : undefined} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

/** Mono rank cell — cyan for the podium top three, muted otherwise. */
function RankCell({ rank, flex }: { rank: number; flex: number }) {
  return (
    <View style={{ flex, alignItems: 'center' }}>
      <Text color={rank <= 3 ? theme.colors.primary : theme.colors.textMuted} style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 16 }}>
        {rank}
      </Text>
    </View>
  );
}

const tableRow = (last: boolean): ViewStyle => ({
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: theme.spacing.md,
  borderBottomWidth: last ? 0 : 1,
  borderBottomColor: theme.colors.border,
});

function AthleteTable({ rows, sex, onRowPress }: { rows: AthleteBoardRow[]; sex: Sex; onRowPress: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ width: '100%' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingBottom: theme.spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <HeadCell flex={ATHLETE_COLS.rank} align="center">#</HeadCell>
        <HeadCell flex={ATHLETE_COLS.athlete} align="start">{t('webportal.leaderboard.colAthlete')}</HeadCell>
        <HeadCell flex={ATHLETE_COLS.tier} align="start">{t('webportal.leaderboard.colTier')}</HeadCell>
        <HeadCell flex={ATHLETE_COLS.result} align="end">{t('leaderboards.ffmi')}</HeadCell>
      </View>
      {rows.map((row, i) => {
        const rank = i + 1;
        const tier = ffmiTier(row.ffmi, sex);
        return (
          <Pressable
            key={row.athlete_id}
            onPress={() => onRowPress(row.athlete_id)}
            style={({ pressed }) => [tableRow(i === rows.length - 1), { opacity: pressed ? 0.85 : 1 }]}
          >
            <RankCell rank={rank} flex={ATHLETE_COLS.rank} />
            <View style={{ flex: ATHLETE_COLS.athlete, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.sm }}>
              <ProfileAvatar name={row.full_name} avatarMediaId={row.avatar_media_id} size={40} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1} style={textStart}>
                  {row.full_name ?? ''}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  {row.handle ? (
                    <Text variant="caption" muted numberOfLines={1}>
                      @{row.handle}
                    </Text>
                  ) : null}
                  {row.primary_goal ? (
                    <Text variant="caption" muted numberOfLines={1}>
                      {t(`goals.${row.primary_goal}`, { defaultValue: row.primary_goal })}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
            <View style={{ flex: ATHLETE_COLS.tier, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm }}>
              <RankCrest tier={tier} size={26} />
              <TierBadge tier={tier} />
            </View>
            <View style={{ flex: ATHLETE_COLS.result, alignItems: 'flex-end', paddingHorizontal: theme.spacing.sm }}>
              <Text variant="display" color={theme.colors.primary} style={{ fontSize: 20, lineHeight: 24 }}>
                {row.ffmi.toFixed(1)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function CoachTable({ rows, onRowPress }: { rows: CoachBoardRow[]; onRowPress: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ width: '100%' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingBottom: theme.spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <HeadCell flex={COACH_COLS.rank} align="center">#</HeadCell>
        <HeadCell flex={COACH_COLS.coach} align="start">{t('webportal.leaderboard.colCoach')}</HeadCell>
        <HeadCell flex={COACH_COLS.result} align="end">{t('leaderboards.medianProgress')}</HeadCell>
      </View>
      {rows.map((row, i) => {
        const rank = i + 1;
        return (
          <Pressable
            key={row.coach_id}
            onPress={() => onRowPress(row.coach_id)}
            style={({ pressed }) => [tableRow(i === rows.length - 1), { opacity: pressed ? 0.85 : 1 }]}
          >
            <RankCell rank={rank} flex={COACH_COLS.rank} />
            <View style={{ flex: COACH_COLS.coach, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.sm }}>
              <ProfileAvatar name={row.full_name} avatarMediaId={row.avatar_media_id} size={40} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1} style={textStart}>
                  {row.full_name ?? ''}
                </Text>
                <Text variant="caption" muted numberOfLines={1} style={textStart}>
                  {t('leaderboards.clientsImproved', { improved: row.improved_clients, tracked: row.tracked_clients })}
                </Text>
              </View>
            </View>
            <View style={{ flex: COACH_COLS.result, alignItems: 'flex-end', paddingHorizontal: theme.spacing.sm }}>
              <Text variant="display" color={theme.colors.primary} style={{ fontSize: 20, lineHeight: 24 }}>
                {medianLabel(row.median_goal_progress)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The coach viewer's own standing, pinned above the coach board (E4 — parity with athletes). */
function MyCoachStandingCard({ rank, onManage }: { rank: MyCoachRank | null; onManage: () => void }) {
  const { t } = useTranslation();
  if (rank) {
    return (
      <GlassCard glowColor={theme.colors.primary}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <View style={{ width: 28, alignItems: 'center' }}>
            <Text color={theme.colors.primary} style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 16 }}>
              {rank.rank}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title" style={textStart}>
              {t('leaderboards.you')}
            </Text>
            <Text variant="caption" muted style={textStart}>
              {t('leaderboards.rankOf', { rank: rank.rank, total: rank.total })} ·{' '}
              {t('leaderboards.clientsImproved', { improved: rank.improved_clients, tracked: rank.tracked_clients })}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="display" color={theme.colors.primary} style={{ fontSize: 22, lineHeight: 26 }}>
              {medianLabel(rank.median_goal_progress)}
            </Text>
            <Text variant="label" muted>
              {t('leaderboards.medianProgress')}
            </Text>
          </View>
        </View>
      </GlassCard>
    );
  }
  return (
    <Pressable onPress={onManage} accessibilityRole="button">
      <GlassCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Icon name="trophy-outline" size={22} color={theme.colors.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" style={textStart}>
              {t('leaderboards.you')}
            </Text>
            <Text variant="caption" muted style={textStart}>
              {t('leaderboards.coachNudge')}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color={theme.colors.textMuted} />
        </View>
      </GlassCard>
    </Pressable>
  );
}

// ── Desktop compact "You" standing — a single slim, full-width highlighted row pinned
// ABOVE the ranked table (replaces the wide side rail). Cyan-tinted, one line. Module-scope
// → their OWN useTranslation. Reuse the exact same rank data + tier/stat helpers.
const standingBarStyle: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: theme.spacing.md,
  paddingVertical: theme.spacing.md,
  paddingHorizontal: theme.spacing.lg,
  backgroundColor: 'rgba(63,217,192,0.1)',
  borderWidth: 1,
  borderColor: 'rgba(63,217,192,0.3)',
  borderRadius: theme.radii.md,
};

function MyStandingBar({
  rank,
  standing,
  sex,
  onManage,
}: {
  rank: MyAthleteRank | null;
  standing: LeagueStanding | undefined;
  sex: Sex;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  if (rank) {
    const tier = ffmiTier(rank.ffmi, sex);
    return (
      <View style={standingBarStyle}>
        <Text color={theme.colors.primary} style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 16 }}>
          {rank.rank}
        </Text>
        <Text variant="bodyStrong" numberOfLines={1} style={textStart}>
          {t('leaderboards.you')}
        </Text>
        <TierBadge tier={tier} />
        <Text variant="caption" muted numberOfLines={1}>
          {t('leaderboards.rankOf', { rank: rank.rank, total: rank.total })}
        </Text>
        <View style={{ flex: 1 }} />
        <Text variant="display" color={theme.colors.primary} style={{ fontSize: 18, lineHeight: 22 }}>
          {rank.ffmi.toFixed(1)}
        </Text>
        <Text variant="label" muted>
          {t('leaderboards.ffmi')}
        </Text>
      </View>
    );
  }
  // No qualifying standing → a slim, actionable nudge row.
  const needsReading = !standing?.hasVerifiedReading;
  return (
    <Pressable onPress={onManage} accessibilityRole="button" style={standingBarStyle}>
      <Icon name="trophy-outline" size={20} color={theme.colors.primary} />
      <Text variant="bodyStrong" numberOfLines={1} style={textStart}>
        {t('leaderboards.you')}
      </Text>
      <Text variant="caption" muted numberOfLines={1} style={[textStart, { flex: 1 }]}>
        {needsReading ? t('leaderboards.nudgeReading') : t('leaderboards.nudgeOptIn')}
      </Text>
      {!needsReading ? <Icon name="chevron-forward" size={18} color={theme.colors.textMuted} /> : null}
    </Pressable>
  );
}

function MyCoachStandingBar({ rank, onManage }: { rank: MyCoachRank | null; onManage: () => void }) {
  const { t } = useTranslation();
  if (rank) {
    return (
      <View style={standingBarStyle}>
        <Text color={theme.colors.primary} style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 16 }}>
          {rank.rank}
        </Text>
        <Text variant="bodyStrong" numberOfLines={1} style={textStart}>
          {t('leaderboards.you')}
        </Text>
        <Text variant="caption" muted numberOfLines={1} style={{ flex: 1 }}>
          {t('leaderboards.rankOf', { rank: rank.rank, total: rank.total })} ·{' '}
          {t('leaderboards.clientsImproved', { improved: rank.improved_clients, tracked: rank.tracked_clients })}
        </Text>
        <Text variant="display" color={theme.colors.primary} style={{ fontSize: 18, lineHeight: 22 }}>
          {medianLabel(rank.median_goal_progress)}
        </Text>
        <Text variant="label" muted>
          {t('leaderboards.medianProgress')}
        </Text>
      </View>
    );
  }
  return (
    <Pressable onPress={onManage} accessibilityRole="button" style={standingBarStyle}>
      <Icon name="trophy-outline" size={20} color={theme.colors.primary} />
      <Text variant="bodyStrong" numberOfLines={1} style={textStart}>
        {t('leaderboards.you')}
      </Text>
      <Text variant="caption" muted numberOfLines={1} style={[textStart, { flex: 1 }]}>
        {t('leaderboards.coachNudge')}
      </Text>
      <Icon name="chevron-forward" size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
}

export function LeaderboardsScreen({ inTab = false }: { inTab?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, role } = useAuth();
  const { active: wide } = useChrome();
  const userId = session?.user?.id;
  const isCoach = role === 'coach';

  const standingQ = useMyLeagueStanding(userId);
  const mySex = standingQ.data?.sex ?? null;

  const [board, setBoard] = useState<Board>('athletes');
  const [period, setPeriod] = useState<LeaderboardPeriod>('all');
  const [sex, setSex] = useState<Sex>('male');
  const [infoOpen, setInfoOpen] = useState(false);
  // Default the sex segment to the viewer's own sex once it loads (without overriding a
  // manual choice — only applies while the user hasn't touched the toggle).
  const [sexTouched, setSexTouched] = useState(false);
  const effectiveSex: Sex = !sexTouched && mySex ? mySex : sex;

  const athletesQ = useTopAthletes(effectiveSex, period);
  const coachesQ = useTopCoaches(period);
  const myRankQ = useMyAthleteRank(effectiveSex, period);
  const myCoachRankQ = useMyCoachRank(period, board === 'coaches' && isCoach);
  useRefreshOnFocus(board === 'athletes' ? athletesQ.refetch : coachesQ.refetch);

  const activeQ = board === 'athletes' ? athletesQ : coachesQ;
  const athletes = athletesQ.data ?? [];
  const coaches = coachesQ.data ?? [];

  // The pinned "You" card shows only on the athletes board for the viewer's own sex segment.
  const showMyStanding = board === 'athletes' && mySex != null && effectiveSex === mySex;

  const boardOptions = useMemo(
    () => [
      { value: 'athletes' as const, label: t('leaderboards.athletes') },
      { value: 'coaches' as const, label: t('leaderboards.coaches') },
    ],
    [t],
  );
  const periodOptions = useMemo(
    () => [
      { value: 'month' as const, label: t('leaderboards.period.month') },
      { value: 'quarter' as const, label: t('leaderboards.period.quarter') },
      { value: 'all' as const, label: t('leaderboards.period.all') },
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
      {/* In tab mode there's no stack header, so render the screen title here. */}
      {inTab ? (
        <Text variant="h1" style={textStart}>
          {t('leaderboards.title')}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Text variant="body" muted style={[textStart, { flex: 1 }]}>
          {t('leaderboards.subtitle')}
        </Text>
        {board === 'athletes' ? (
          <Pressable
            onPress={() => setInfoOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('leaderboards.ffmiInfo.title')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Icon name="info" size={16} color={theme.colors.primary} />
            <Text variant="caption" color={theme.colors.primary}>
              {t('leaderboards.whatsFfmi')}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Segmented options={boardOptions} value={board} onChange={setBoard} />
      <Segmented options={periodOptions} value={period} onChange={setPeriod} />
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
      {showMyStanding ? (
        <MyStandingCard
          rank={myRankQ.data ?? null}
          standing={standingQ.data}
          sex={effectiveSex}
          onManage={() => router.push('/public-profile-edit')}
        />
      ) : null}
      {board === 'coaches' && isCoach ? (
        <MyCoachStandingCard rank={myCoachRankQ.data ?? null} onManage={() => router.push('/public-profile-edit')} />
      ) : null}
    </View>
  );

  const empty = activeQ.isLoading ? (
    <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
  ) : activeQ.isError ? (
    <EmptyState
      icon="cloud-offline-outline"
      title={t('leaderboards.loadError')}
      actionLabel={t('common.retry')}
      onAction={() => activeQ.refetch()}
    />
  ) : (
    <EmptyState icon="trophy-outline" title={t('leaderboards.emptyTitle')} subtitle={t('leaderboards.emptySub')} />
  );

  // ── Desktop (coach web shell): centered, capped column with a proper ranked TABLE and
  // the "my standing" summary beside it. Reuses the exact same data + tier helpers. ──
  if (wide) {
    const hasRows = board === 'athletes' ? athletes.length > 0 : coaches.length > 0;
    const ready = !activeQ.isLoading && !activeQ.isError && hasRows;
    // The viewer's own standing, shown as a compact full-width bar ABOVE the table.
    const standingBar = showMyStanding ? (
      <MyStandingBar
        rank={myRankQ.data ?? null}
        standing={standingQ.data}
        sex={effectiveSex}
        onManage={() => router.push('/public-profile-edit')}
      />
    ) : board === 'coaches' && isCoach ? (
      <MyCoachStandingBar rank={myCoachRankQ.data ?? null} onManage={() => router.push('/public-profile-edit')} />
    ) : null;

    return (
      <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.xl, gap: theme.spacing.lg }}>
        {/* Header */}
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="h1" style={textStart}>
            {t('leaderboards.title')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Text variant="body" muted style={[textStart, { flex: 1 }]}>
              {t('leaderboards.subtitle')}
            </Text>
            {board === 'athletes' ? (
              <Pressable
                onPress={() => setInfoOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('leaderboards.ffmiInfo.title')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Icon name="info" size={16} color={theme.colors.primary} />
                <Text variant="caption" color={theme.colors.primary}>
                  {t('leaderboards.whatsFfmi')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Controls — board + period toggles share their own row (with breathing room),
            the men/women filter sits on the row below so nothing is squeezed. */}
        <View style={{ gap: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.lg }}>
            <Segmented options={boardOptions} value={board} onChange={setBoard} style={{ width: 240 }} />
            <Segmented options={periodOptions} value={period} onChange={setPeriod} style={{ width: 380 }} />
          </View>
          {board === 'athletes' ? (
            <Segmented
              options={sexOptions}
              value={effectiveSex}
              onChange={(v) => {
                setSexTouched(true);
                setSex(v);
              }}
              style={{ width: 200 }}
            />
          ) : null}
        </View>

        {/* Compact "You" standing bar (full width), then the ranked table spanning the
            full width below it — no side rail. */}
        {standingBar}

        <Card>
          {ready ? (
            board === 'athletes' ? (
              <AthleteTable
                rows={athletes}
                sex={effectiveSex}
                onRowPress={(id) => router.push(`/athlete-profile/${id}`)}
              />
            ) : (
              <CoachTable rows={coaches} onRowPress={(id) => router.push(`/coach-profile/${id}`)} />
            )
          ) : (
            empty
          )}
        </Card>

        <FfmiInfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} />
      </Screen>
    );
  }

  return (
    <Screen gradient padded={false} edges={inTab ? ['top', 'bottom'] : ['bottom']}>
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
      <FfmiInfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} />
    </Screen>
  );
}

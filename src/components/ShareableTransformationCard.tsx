// ShareableTransformationCard (Engagement E3) — a Raptor-branded before/after card for the
// public coach showcase. Designed to be SCREENSHOTTED and posted to social: the brand wordmark
// + cyan-on-onyx palette make a shared image recognizably ours. A native capture→share button
// (react-native-view-shot + expo-sharing) exports the card directly; on web the user screenshots
// manually (view-shot has no reliable web path), so the button is hidden there.
// Module-scope component → its OWN useTranslation (CLAUDE.md §13 / i18n rule).
import { useRef } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { theme, type Tier } from '@/theme';
import { Icon, Text, SignedImage, TierChip } from '@/components/ui';
import type { CoachTransformation } from '@/lib/public-profiles';

const kg = (g: number | null) => (g == null ? null : Math.round((g / 1000) * 10) / 10);

export function ShareableTransformationCard({ item }: { item: CoachTransformation }) {
  const { t } = useTranslation();
  const shotRef = useRef<View>(null);

  const bfPct = item.body_fat_delta_bp == null ? null : Math.round((item.body_fat_delta_bp / 100) * 10) / 10;
  const lmKg = kg(item.lean_mass_delta_grams);

  const onShare = async () => {
    if (Platform.OS === 'web') return;
    try {
      const uri = await captureRef(shotRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {
      /* capture/share unavailable (e.g. stale dev client) — no-op, the card still renders */
    }
  };

  return (
    <View style={{ width: 300 }}>
      <View
        ref={shotRef}
        collapsable={false}
        style={{
          backgroundColor: theme.colors.bg, // solid (onyx) so the captured PNG isn't transparent
          borderRadius: theme.radii.lg,
          borderWidth: 1,
          borderColor: theme.colors.glassBorder,
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
          overflow: 'hidden',
        }}
      >
        {/* Header: client first name + goal + duration */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="bodyStrong">{item.client_first_name ?? ''}</Text>
          {item.duration_weeks != null ? (
            <Text variant="caption" muted>
              {t('coachProfile.weeks', { count: item.duration_weeks })}
            </Text>
          ) : null}
        </View>

        {/* Before / after photos */}
        {item.before_media_id || item.after_media_id ? (
          <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
            {[
              { id: item.before_media_id, label: t('coachProfile.before') },
              { id: item.after_media_id, label: t('coachProfile.after') },
            ].map((side, i) => (
              <View key={i} style={{ flex: 1, gap: 2 }}>
                {side.id ? (
                  <SignedImage mediaId={side.id} style={{ width: '100%', height: 150, borderRadius: theme.radii.md }} />
                ) : (
                  <View style={{ width: '100%', height: 150, borderRadius: theme.radii.md, backgroundColor: theme.colors.glass }} />
                )}
                <Text variant="label" muted align="center">
                  {side.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Delta stats */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
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

        {/* Tier before → after */}
        {item.tier_before || item.tier_after ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            {item.tier_before ? <TierChip tier={item.tier_before as Tier} label={t(`leaderboards.tier.${item.tier_before}`)} /> : null}
            <Icon name="arrow-up" size={14} color={theme.colors.textMuted} />
            {item.tier_after ? <TierChip tier={item.tier_after as Tier} label={t(`leaderboards.tier.${item.tier_after}`)} /> : null}
          </View>
        ) : null}

        {item.caption ? (
          <Text variant="caption" muted>
            {item.caption}
          </Text>
        ) : null}

        {/* Brand wordmark — makes a screenshot recognizably Raptor */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <Icon name="flash" size={12} color={theme.colors.primary} />
          <Text color={theme.colors.primary} style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 11, letterSpacing: 1 }}>
            RAPTOR
          </Text>
        </View>
      </View>

      {Platform.OS !== 'web' ? (
        <Pressable
          onPress={onShare}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: theme.spacing.sm }}
        >
          <Icon name="send" size={15} color={theme.colors.primary} />
          <Text variant="caption" color={theme.colors.primary}>
            {t('coachProfile.share')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

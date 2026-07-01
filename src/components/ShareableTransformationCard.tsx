// ShareableTransformationCard (Engagement E3, redesigned to the "1B / Frame" mockup) — a
// Raptor-branded before/after card for the public coach showcase, built to be SCREENSHOTTED
// and posted to social. Image-led editorial layout: full-bleed before/after photos split by a
// glowing cyan divider, a top scrim (TRANSFORMATION tag + client name + weeks badge), and a
// bottom stats band (body-fat / lean-mass deltas + tier rank-up + coach credit + RAPTOR mark).
// The same design renders at three social ratios (Square 1:1, Portrait 4:5, Story 9:16); the
// coach picks one and shares it. A native capture→share button exports the card directly; on
// web the user screenshots (view-shot has no reliable web path), so the button is hidden there.
// Module-scope component → its OWN useTranslation (CLAUDE.md §13 / i18n rule).
import { Fragment, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { theme } from '@/theme';
import { TIER_COLORS, type TierId } from '@/lib/leagues';
import { forwardChevron } from '@/lib/rtl';
import { Icon, Segmented, Text, SignedImage } from '@/components/ui';
import type { CoachTransformation } from '@/lib/public-profiles';

type Ratio = 'square' | 'portrait' | 'story';
const ASPECT: Record<Ratio, number> = { square: 1, portrait: 4 / 5, story: 9 / 16 }; // width / height
const CARD_W = 300;
const ONYX = '#0A0B0F'; // solid so the captured PNG isn't transparent (matches theme.colors.bg)
const SCRIM_DARK = 'rgba(8,9,12,0.94)';
const SCRIM_MID = 'rgba(8,9,12,0.5)';
const BEFORE_GREY = '#C3C6CE';

const kg = (g: number | null) => (g == null ? null : Math.round((g / 1000) * 10) / 10);

function TierPill({ tid, label }: { tid: TierId; label: string }) {
  return (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7 }}>
      <Text style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 10, letterSpacing: 0.5, color: TIER_COLORS[tid] }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

export function ShareableTransformationCard({ item, coachName }: { item: CoachTransformation; coachName?: string | null }) {
  const { t } = useTranslation();
  const shotRef = useRef<View>(null);
  const [ratio, setRatio] = useState<Ratio>('portrait');

  const bfPct = item.body_fat_delta_bp == null ? null : Math.round((item.body_fat_delta_bp / 100) * 10) / 10;
  const lmKg = kg(item.lean_mass_delta_grams);

  const stats: { value: string; unit?: string; label: string; color: string }[] = [];
  if (bfPct != null) {
    stats.push({
      value: `${bfPct >= 0 ? '−' : '+'}${Math.abs(bfPct)}%`,
      label: t('athleteProfile.bodyFat'),
      color: bfPct >= 0 ? theme.colors.success : theme.colors.danger,
    });
  }
  if (lmKg != null) {
    stats.push({
      value: `${lmKg >= 0 ? '+' : '−'}${Math.abs(lmKg)}`,
      unit: 'kg',
      label: t('athleteProfile.leanMass'),
      color: lmKg >= 0 ? theme.colors.success : theme.colors.danger,
    });
  }

  const tierBefore = item.tier_before as TierId | null;
  const tierAfter = item.tier_after as TierId | null;
  const tierChanged = !!(tierBefore && tierAfter && tierBefore !== tierAfter);
  const hasTier = !!(tierBefore || tierAfter);

  const onShare = async () => {
    if (Platform.OS === 'web') return;
    try {
      const uri = await captureRef(shotRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {
      /* capture/share unavailable (e.g. stale dev client) — no-op, the card still renders */
    }
  };

  const mono = theme.fontFamily.monoRegular;
  const monoB = theme.fontFamily.monoBold;

  return (
    <View style={{ width: CARD_W }}>
      {/* ── The capture target: the branded card, exactly `ratio` shaped ─────────── */}
      <View
        ref={shotRef}
        collapsable={false}
        style={{
          width: CARD_W,
          aspectRatio: ASPECT[ratio],
          backgroundColor: ONYX,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: theme.colors.glassBorder,
          overflow: 'hidden',
        }}
      >
        {/* Photo hero — grows to fill everything above the stats band */}
        <View style={{ flex: 1, flexDirection: 'row', position: 'relative' }}>
          {[
            { id: item.before_media_id },
            { id: item.after_media_id },
          ].map((side, i) => (
            <Fragment key={i}>
              {i === 1 ? (
                <View
                  style={{
                    width: 2,
                    alignSelf: 'stretch',
                    backgroundColor: theme.colors.primary,
                    shadowColor: theme.colors.primary,
                    shadowOpacity: 0.7,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 0 },
                  }}
                />
              ) : null}
              <View style={{ flex: 1, backgroundColor: theme.colors.surface }}>
                {side.id ? (
                  <SignedImage mediaId={side.id} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : null}
              </View>
            </Fragment>
          ))}

          {/* Top scrim: tag + name + weeks */}
          <LinearGradient
            colors={[SCRIM_DARK, SCRIM_MID, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              paddingHorizontal: 14,
              paddingTop: 13,
              paddingBottom: 18,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2, color: theme.colors.primary }}>
                {t('coachProfile.cardTag').toUpperCase()}
              </Text>
              <Text
                numberOfLines={1}
                style={{ fontFamily: theme.fontFamily.displayBold, fontSize: 26, color: theme.colors.text, letterSpacing: -0.5, marginTop: 3 }}
              >
                {item.client_first_name ?? ''}
              </Text>
            </View>
            {item.duration_weeks != null ? (
              <View
                style={{
                  backgroundColor: 'rgba(8,9,12,0.5)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.16)',
                  borderRadius: 10,
                  paddingVertical: 6,
                  paddingHorizontal: 9,
                }}
              >
                <Text style={{ fontFamily: monoB, fontSize: 13, color: theme.colors.text }}>
                  {t('coachProfile.weeksShort', { count: item.duration_weeks })}
                </Text>
              </View>
            ) : null}
          </LinearGradient>

          {/* Bottom scrim: BEFORE / AFTER labels */}
          <LinearGradient
            colors={['transparent', 'rgba(8,9,12,0.82)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              paddingHorizontal: 14,
              paddingTop: 16,
              paddingBottom: 10,
              flexDirection: 'row',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1.5, color: BEFORE_GREY }}>
              {t('coachProfile.before').toUpperCase()}
            </Text>
            <Text style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1.5, color: theme.colors.primary }}>
              {t('coachProfile.after').toUpperCase()}
            </Text>
          </LinearGradient>
        </View>

        {/* Stats band — kept compact so the photo hero stays dominant even at the Square ratio */}
        <View style={{ backgroundColor: ONYX, paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
          {stats.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {stats.map((s, i) => (
                <Fragment key={i}>
                  {i > 0 ? (
                    <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.colors.glassBorder, marginHorizontal: 12 }} />
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: monoB, fontSize: 20, color: s.color }}>
                      {s.value}
                      {s.unit ? <Text style={{ fontFamily: mono, fontSize: 12, color: theme.colors.textMuted }}>{` ${s.unit}`}</Text> : null}
                    </Text>
                    <Text style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: 1.2, color: theme.colors.textMuted, textTransform: 'uppercase', marginTop: 2 }}>
                      {s.label}
                    </Text>
                  </View>
                </Fragment>
              ))}
            </View>
          ) : null}

          {hasTier ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: mono, fontSize: 8, letterSpacing: 2, color: theme.colors.textMuted, textTransform: 'uppercase' }}>
                {tierChanged ? t('coachProfile.rankUp') : t('coachProfile.rank')}
              </Text>
              {tierChanged ? (
                <>
                  <TierPill tid={tierBefore!} label={t(`leaderboards.tier.${tierBefore}`)} />
                  <Icon name={forwardChevron()} size={12} color={theme.colors.textMuted} />
                  <TierPill tid={tierAfter!} label={t(`leaderboards.tier.${tierAfter}`)} />
                </>
              ) : (
                <TierPill tid={(tierAfter ?? tierBefore)!} label={t(`leaderboards.tier.${tierAfter ?? tierBefore}`)} />
              )}
            </View>
          ) : null}

          <View style={{ height: 1, backgroundColor: theme.colors.glassBorder }} />

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
            {coachName ? (
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontFamily: mono, fontSize: 8.5, letterSpacing: 1, color: theme.colors.textMuted, textTransform: 'uppercase' }}
              >
                {t('coachProfile.coachedBy', { name: coachName })}
              </Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View
                  style={{
                    width: 9,
                    height: 9,
                    backgroundColor: theme.colors.primary,
                    borderRadius: 2,
                    transform: [{ rotate: '45deg' }],
                    shadowColor: theme.colors.primary,
                    shadowOpacity: 0.6,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 0 },
                  }}
                />
                <Text style={{ fontFamily: monoB, fontSize: 12, letterSpacing: 3, color: theme.colors.primary }}>RAPTOR</Text>
              </View>
              <Text style={{ fontFamily: mono, fontSize: 7.5, letterSpacing: 1, color: '#5C616E' }}>train.raptor.app</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Footer (NOT captured): pick a social ratio + share ───────────────────── */}
      <View style={{ marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
        <Segmented
          options={[
            { value: 'square', label: t('coachProfile.ratioSquare') },
            { value: 'portrait', label: t('coachProfile.ratioPortrait') },
            { value: 'story', label: t('coachProfile.ratioStory') },
          ]}
          value={ratio}
          onChange={(v) => setRatio(v as Ratio)}
        />
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
    </View>
  );
}

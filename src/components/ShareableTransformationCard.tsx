// ShareableTransformationCard (Engagement E3 "1B / Frame" + 0087 Transformation Manager) —
// a Raptor-branded transformation card for the public showcase, built to be SAVED + posted
// to social. Image-led editorial layout: full-bleed photos split by glowing cyan dividers,
// a top scrim (TRANSFORMATION tag + client name + a VERIFIED badge when the numbers are
// app-backed + weeks badge), and a compact stats band (body-fat / lean-mass deltas + tier
// rank-up + coach credit + RAPTOR mark). Renders at three social ratios (1:1, 4:5, 9:16).
//
// 0087 layouts render from `item.photos` (ordered cells, each with its own frame and an
// optional presentation-only taken_on date chip):
//   side / stack — the classic 2-photo pair · slider — 2 photos with a draggable reveal
//   handle · strip — 3 photos in a row · grid — 4 photos, 2×2.
// "Save photo" works on every device via cardCapture (native share sheet incl. Save Image;
// web = PNG download). Module-scope components → their OWN useTranslation (i18n rule).
import { Fragment, useRef, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '@/theme';
import { TIER_COLORS, type TierId } from '@/lib/leagues';
import { forwardChevron } from '@/lib/rtl';
import { frameStyle } from '@/lib/photoFrame';
import { captureCard } from '@/lib/cardCapture';
import { Icon, Segmented, Text, SignedImage, useToast } from '@/components/ui';
import type { CoachTransformation, TransformationPhoto } from '@/lib/public-profiles';

type Ratio = 'square' | 'portrait' | 'story';
const ASPECT: Record<Ratio, number> = { square: 1, portrait: 4 / 5, story: 9 / 16 }; // width / height
const CARD_W = 300;
const ONYX = '#0A0B0F'; // solid so the captured PNG isn't transparent (matches theme.colors.bg)
const SCRIM_DARK = 'rgba(8,9,12,0.94)';
const SCRIM_MID = 'rgba(8,9,12,0.5)';
const BEFORE_GREY = '#C3C6CE';

const kg = (g: number | null) => (g == null ? null : Math.round((g / 1000) * 10) / 10);

/** 'YYYY-MM-DD' → a compact localized chip ("Jan 15"); null on malformed input. */
function dateChip(takenOn: string | null, locale: string): string | null {
  if (!takenOn || !/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) return null;
  const [y, m, d] = takenOn.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  } catch {
    return takenOn;
  }
}

function TierPill({ tid, label }: { tid: TierId; label: string }) {
  return (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7 }}>
      <Text style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 10, letterSpacing: 0.5, color: TIER_COLORS[tid] }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

/** The glowing cyan divider between photo cells. */
function Divider({ horizontal }: { horizontal?: boolean }) {
  return (
    <View
      style={{
        ...(horizontal ? { height: 2, alignSelf: 'stretch' as const } : { width: 2, alignSelf: 'stretch' as const }),
        backgroundColor: theme.colors.primary,
        shadowColor: theme.colors.primary,
        shadowOpacity: 0.7,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 0 },
      }}
    />
  );
}

/** One photo cell: a cover image with an optional framing transform, plus a corner chip —
 *  a taken-on date when set, else an optional BEFORE/AFTER-style label. */
function PhotoCell({
  photo,
  label,
  labelColor,
}: {
  photo: TransformationPhoto | null;
  label?: string | null;
  labelColor?: string;
}) {
  const { i18n } = useTranslation();
  const [sz, setSz] = useState({ w: 0, h: 0 });
  const frame = photo?.frame ?? null;
  const framed = frame && frame.scale > 1.001;
  const chip = dateChip(photo?.taken_on ?? null, i18n.language)?.toUpperCase() ?? label ?? null;
  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.surface, overflow: 'hidden' }}
      onLayout={framed ? (e) => setSz({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }) : undefined}
    >
      {photo?.media_id ? (
        framed && sz.w > 0 ? (
          <SignedImage mediaId={photo.media_id} resizeMode="cover" style={frameStyle(frame, sz.w, sz.h)} />
        ) : (
          <SignedImage mediaId={photo.media_id} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        )
      ) : null}
      {chip ? (
        <View style={{ position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(8,9,12,0.55)', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7 }}>
          <Text style={{ fontFamily: theme.fontFamily.monoRegular, fontSize: 10, letterSpacing: 1.5, color: labelColor ?? BEFORE_GREY }}>{chip}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Slider layout (0087): the BEFORE photo as the base layer, the AFTER photo clipped in from
 *  the right, split by a draggable glowing handle. The DRAG surface is the handle only (not
 *  the whole hero) so the card keeps scrolling normally inside lists. */
function SliderHero({ before, after, beforeLabel, afterLabel }: {
  before: TransformationPhoto | null;
  after: TransformationPhoto | null;
  beforeLabel: string;
  afterLabel: string;
}) {
  const { i18n } = useTranslation();
  const [sz, setSz] = useState({ w: 0, h: 0 });
  const w = sz.w;
  const [reveal, setReveal] = useState(0.5); // fraction of the width where AFTER begins
  const wRef = useRef(w);
  wRef.current = w;
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const startReveal = useRef(0.5);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startReveal.current = revealRef.current;
      },
      onPanResponderMove: (_e, g) => {
        if (wRef.current <= 0) return;
        const next = startReveal.current + g.dx / wRef.current;
        setReveal(Math.max(0.06, Math.min(0.94, next)));
      },
    }),
  ).current;

  const splitX = w * reveal;
  const beforeChip = dateChip(before?.taken_on ?? null, i18n.language)?.toUpperCase() ?? beforeLabel;
  const afterChip = dateChip(after?.taken_on ?? null, i18n.language)?.toUpperCase() ?? afterLabel;
  const renderPhoto = (p: TransformationPhoto | null) =>
    p?.media_id ? (
      p.frame && p.frame.scale > 1.001 && sz.w > 0 && sz.h > 0 ? (
        <SignedImage mediaId={p.media_id} resizeMode="cover" style={frameStyle(p.frame, sz.w, sz.h)} />
      ) : (
        <SignedImage mediaId={p.media_id} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
      )
    ) : null;

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.surface, overflow: 'hidden' }}
      onLayout={(e) => setSz({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {/* Base layer: BEFORE fills the hero. */}
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: w > 0 ? w : '100%', overflow: 'hidden' }}>
        {renderPhoto(before)}
      </View>
      {/* Overlay: AFTER clipped to the right of the handle, image kept aligned. */}
      {w > 0 ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: splitX, right: 0, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: -splitX, width: w }}>{renderPhoto(after)}</View>
        </View>
      ) : null}
      {/* Split line + drag handle. */}
      {w > 0 ? (
        <>
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: splitX - 1, width: 2, backgroundColor: theme.colors.primary, shadowColor: theme.colors.primary, shadowOpacity: 0.8, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } }} />
          <View
            {...responder.panHandlers}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            style={{ position: 'absolute', top: '50%', left: splitX - 13, marginTop: -13, width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 2 } }}
          >
            <Icon name="chevrons-left-right" size={13} color={theme.colors.onPrimary} />
          </View>
        </>
      ) : null}
      <View style={{ position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(8,9,12,0.55)', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7 }}>
        <Text style={{ fontFamily: theme.fontFamily.monoRegular, fontSize: 10, letterSpacing: 1.5, color: BEFORE_GREY }}>{beforeChip}</Text>
      </View>
      <View style={{ position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(8,9,12,0.55)', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7 }}>
        <Text style={{ fontFamily: theme.fontFamily.monoRegular, fontSize: 10, letterSpacing: 1.5, color: theme.colors.primary }}>{afterChip}</Text>
      </View>
    </View>
  );
}

export function ShareableTransformationCard({
  item,
  coachName,
  shareable = true,
}: {
  item: CoachTransformation;
  coachName?: string | null;
  shareable?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const shotRef = useRef<View>(null);
  const [ratio, setRatio] = useState<Ratio>('portrait');
  const [saving, setSaving] = useState(false);

  const bfPct = item.body_fat_delta_bp == null ? null : Math.round((item.body_fat_delta_bp / 100) * 10) / 10;
  const lmKg = kg(item.lean_mass_delta_grams);

  const stats: { value: string; unit?: string; label: string; color: string }[] = [];
  if (bfPct != null) {
    stats.push({ value: `${bfPct >= 0 ? '−' : '+'}${Math.abs(bfPct)}%`, label: t('athleteProfile.bodyFat'), color: bfPct >= 0 ? theme.colors.success : theme.colors.danger });
  }
  if (lmKg != null) {
    stats.push({ value: `${lmKg >= 0 ? '+' : '−'}${Math.abs(lmKg)}`, unit: 'kg', label: t('athleteProfile.leanMass'), color: lmKg >= 0 ? theme.colors.success : theme.colors.danger });
  }

  const tierBefore = item.tier_before as TierId | null;
  const tierAfter = item.tier_after as TierId | null;
  const tierChanged = !!(tierBefore && tierAfter && tierBefore !== tierAfter);
  const hasTier = !!(tierBefore || tierAfter);

  const photos = item.photos;
  const beforeLabel = t('coachProfile.before').toUpperCase();
  const afterLabel = t('coachProfile.after').toUpperCase();
  const at = (i: number): TransformationPhoto | null => photos[i] ?? null;

  const onSavePhoto = async () => {
    setSaving(true);
    const outcome = await captureCard(shotRef, `${item.client_first_name ?? 'transformation'}-card`);
    setSaving(false);
    if (outcome === 'downloaded') toast.show(t('transformationEditor.photoSaved'));
    else if (outcome === 'failed') toast.show(t('transformationEditor.captureFailed'), 'error');
    // 'shared' → the OS sheet was its own feedback.
  };

  const mono = theme.fontFamily.monoRegular;
  const monoB = theme.fontFamily.monoBold;

  /** The photo hero for the card's layout. side/stack/strip = cells + dividers along one
   *  axis; grid = 2×2 nested rows (no CSS grid — web rule); slider = the reveal overlay. */
  const renderHero = () => {
    switch (item.layout) {
      case 'slider':
        return <SliderHero before={at(0)} after={at(1)} beforeLabel={beforeLabel} afterLabel={afterLabel} />;
      case 'strip':
        return (
          <>
            <PhotoCell photo={at(0)} label={beforeLabel} labelColor={BEFORE_GREY} />
            <Divider />
            <PhotoCell photo={at(1)} />
            <Divider />
            <PhotoCell photo={at(2)} label={afterLabel} labelColor={theme.colors.primary} />
          </>
        );
      case 'grid':
        return (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1, flexDirection: 'row' }}>
              <PhotoCell photo={at(0)} label={beforeLabel} labelColor={BEFORE_GREY} />
              <Divider />
              <PhotoCell photo={at(1)} />
            </View>
            <Divider horizontal />
            <View style={{ flex: 1, flexDirection: 'row' }}>
              <PhotoCell photo={at(2)} />
              <Divider />
              <PhotoCell photo={at(3)} label={afterLabel} labelColor={theme.colors.primary} />
            </View>
          </View>
        );
      case 'stack':
        return (
          <>
            <PhotoCell photo={at(0)} label={beforeLabel} labelColor={BEFORE_GREY} />
            <Divider horizontal />
            <PhotoCell photo={at(1)} label={afterLabel} labelColor={theme.colors.primary} />
          </>
        );
      default: // side
        return (
          <>
            <PhotoCell photo={at(0)} label={beforeLabel} labelColor={BEFORE_GREY} />
            <Divider />
            <PhotoCell photo={at(1)} label={afterLabel} labelColor={theme.colors.primary} />
          </>
        );
    }
  };

  const heroDirection = item.layout === 'stack' || item.layout === 'grid' ? 'column' : 'row';

  return (
    <View style={{ width: CARD_W }}>
      {/* ── The capture target: the branded card, exactly `ratio` shaped ─────────── */}
      <View
        ref={shotRef}
        collapsable={false}
        style={{ width: CARD_W, aspectRatio: ASPECT[ratio], backgroundColor: ONYX, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.glassBorder, overflow: 'hidden' }}
      >
        {/* Photo hero — grows above the stats band */}
        <View style={{ flex: 1, flexDirection: heroDirection, position: 'relative' }}>
          {renderHero()}

          {/* Top scrim: tag + name (+ verified badge) + weeks */}
          <LinearGradient
            colors={[SCRIM_DARK, SCRIM_MID, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2, color: theme.colors.primary }}>{t('coachProfile.cardTag').toUpperCase()}</Text>
              <Text numberOfLines={1} style={{ fontFamily: theme.fontFamily.displayBold, fontSize: 26, lineHeight: 30, color: theme.colors.text, letterSpacing: -0.5, marginTop: 3 }}>
                {item.client_first_name ?? ''}
              </Text>
              {item.verified ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, marginTop: 5, backgroundColor: 'rgba(63,217,192,0.16)', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6 }}>
                  <Icon name="check-circle" size={10} color={theme.colors.primary} />
                  <Text style={{ fontFamily: monoB, fontSize: 8, letterSpacing: 1.5, color: theme.colors.primary }}>{t('coachProfile.verified').toUpperCase()}</Text>
                </View>
              ) : null}
            </View>
            {item.duration_weeks != null ? (
              <View style={{ backgroundColor: 'rgba(8,9,12,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 9 }}>
                <Text style={{ fontFamily: monoB, fontSize: 13, color: theme.colors.text }}>{t('coachProfile.weeksShort', { count: item.duration_weeks })}</Text>
              </View>
            ) : null}
          </LinearGradient>
        </View>

        {/* Stats band — kept compact so the photo hero stays dominant even at the Square ratio */}
        <View style={{ backgroundColor: ONYX, paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
          {stats.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {stats.map((s, i) => (
                <Fragment key={i}>
                  {i > 0 ? <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.colors.glassBorder, marginHorizontal: 12 }} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: monoB, fontSize: 20, color: s.color }}>
                      {s.value}
                      {s.unit ? <Text style={{ fontFamily: mono, fontSize: 12, color: theme.colors.textMuted }}>{` ${s.unit}`}</Text> : null}
                    </Text>
                    <Text style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: 1.2, color: theme.colors.textMuted, textTransform: 'uppercase', marginTop: 2 }}>{s.label}</Text>
                  </View>
                </Fragment>
              ))}
            </View>
          ) : null}

          {hasTier ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: mono, fontSize: 8, letterSpacing: 2, color: theme.colors.textMuted, textTransform: 'uppercase' }}>{tierChanged ? t('coachProfile.rankUp') : t('coachProfile.rank')}</Text>
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
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: mono, fontSize: 8.5, letterSpacing: 1, color: theme.colors.textMuted, textTransform: 'uppercase' }}>
                {t('coachProfile.coachedBy', { name: coachName })}
              </Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 9, height: 9, backgroundColor: theme.colors.primary, borderRadius: 2, transform: [{ rotate: '45deg' }], shadowColor: theme.colors.primary, shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } }} />
                <Text style={{ fontFamily: monoB, fontSize: 12, letterSpacing: 3, color: theme.colors.primary }}>RAPTOR</Text>
              </View>
              <Text style={{ fontFamily: mono, fontSize: 7.5, letterSpacing: 1, color: '#5C616E' }}>train.raptor.app</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Footer (NOT captured): pick a social ratio + save the photo ──────────── */}
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
        {shareable ? (
          <Pressable disabled={saving} onPress={onSavePhoto} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: theme.spacing.sm, opacity: saving ? 0.5 : 1 }}>
            <Icon name="download" size={15} color={theme.colors.primary} />
            <Text variant="caption" color={theme.colors.primary}>{t('transformationEditor.savePhoto')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

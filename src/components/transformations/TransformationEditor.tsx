// TransformationEditor — the shared before/after card authoring surface (coach card + client
// submission). Pick two photos, FRAME each (drag + zoom), choose a layout (side / stacked) and
// the manual stat overrides + dates, and see a LIVE branded-card preview. Leaving all stats
// blank keeps the card VERIFIED (numbers come from the client's app-verified body_metrics);
// typing any stat/date makes it SELF-REPORTED. The parent supplies onSave (the actual
// upsert/submission). Module-scope sub-components get their OWN useTranslation.
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { theme } from '@/theme';
import { textStart } from '@/lib/rtl';
import { TIER_COLORS, type TierId } from '@/lib/leagues';
import { frameStyle, panBy } from '@/lib/photoFrame';
import { captureAndUploadPhoto } from '@/lib/upload';
import type { PhotoFrame, TransformationCardInput, TransformationLayout, CoachTransformation } from '@/lib/public-profiles';
import { Button, GlassCard, Icon, Input, Segmented, SignedImage, Text, useToast } from '@/components/ui';
import { ShareableTransformationCard } from '@/components/ShareableTransformationCard';

const TIERS = Object.keys(TIER_COLORS) as TierId[];
const DEFAULT_FRAME: PhotoFrame = { scale: 1, x: 0, y: 0 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function weeksBetween(a: string | null, b: string | null): number | null {
  if (!a || !b || !DATE_RE.test(a) || !DATE_RE.test(b)) return null;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const t0 = new Date(ay, am - 1, ad).getTime();
  const t1 = new Date(by, bm - 1, bd).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) return null;
  return Math.floor((t1 - t0) / (7 * 86400_000));
}

// ── Photo pick + framing (drag to pan, ± to zoom) ────────────────────────────────
function PhotoFramePicker({
  label,
  mediaId,
  frame,
  busy,
  onPick,
  onFrame,
}: {
  label: string;
  mediaId: string | null;
  frame: PhotoFrame;
  busy: boolean;
  onPick: () => void;
  onFrame: (f: PhotoFrame) => void;
}) {
  const { t } = useTranslation();
  const [sz, setSz] = useState({ w: 0, h: 0 });
  const szRef = useRef(sz);
  szRef.current = sz;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const startFrame = useRef(frame);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startFrame.current = frameRef.current;
      },
      onPanResponderMove: (_e, g) => {
        onFrameRef.current(panBy(startFrame.current, g.dx, g.dy, szRef.current.w, szRef.current.h));
      },
    }),
  ).current;

  const zoom = (delta: number) => onFrame({ ...frame, scale: Math.max(1, Math.min(3, Math.round((frame.scale + delta) * 100) / 100)) });
  const framed = frame.scale > 1.001;

  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text variant="label" muted style={textStart}>{label}</Text>
      <View
        onLayout={(e) => setSz({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={{ width: '100%', aspectRatio: 1, borderRadius: theme.radii.md, overflow: 'hidden', backgroundColor: theme.colors.glass, borderWidth: 1, borderColor: theme.colors.glassBorder, alignItems: 'center', justifyContent: 'center' }}
        {...(mediaId ? responder.panHandlers : {})}
      >
        {mediaId ? (
          framed && sz.w > 0 ? (
            <SignedImage mediaId={mediaId} resizeMode="cover" style={frameStyle(frame, sz.w, sz.h)} />
          ) : (
            <SignedImage mediaId={mediaId} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
          )
        ) : busy ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          <Icon name="camera" size={24} color={theme.colors.textMuted} />
        )}
      </View>
      {mediaId ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable onPress={() => zoom(-0.25)} hitSlop={8} style={{ paddingHorizontal: 10, paddingVertical: 2 }}><Text variant="title" color={theme.colors.text}>−</Text></Pressable>
          <Pressable onPress={() => onFrame(DEFAULT_FRAME)} hitSlop={8} style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="caption" muted>{t('transformationEditor.reframe')}</Text>
          </Pressable>
          <Pressable onPress={() => zoom(0.25)} hitSlop={8} style={{ paddingHorizontal: 10, paddingVertical: 2 }}><Text variant="title" color={theme.colors.text}>+</Text></Pressable>
        </View>
      ) : (
        <Button title={t('transformationEditor.pickPhoto')} variant="ghost" onPress={onPick} loading={busy} />
      )}
    </View>
  );
}

// ── Tier chooser ─────────────────────────────────────────────────────────────────
function TierRow({ label, value, onChange }: { label: string; value: TierId | null; onChange: (v: TierId | null) => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 4 }}>
      <Text variant="label" muted style={textStart}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {TIERS.map((tier) => {
          const on = value === tier;
          return (
            <Pressable
              key={tier}
              onPress={() => onChange(on ? null : tier)}
              style={{ paddingVertical: 4, paddingHorizontal: 9, borderRadius: theme.radii.sm, borderWidth: 1, borderColor: on ? TIER_COLORS[tier] : theme.colors.glassBorder, backgroundColor: on ? 'rgba(255,255,255,0.06)' : 'transparent' }}
            >
              <Text style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 10, letterSpacing: 0.5, color: on ? TIER_COLORS[tier] : theme.colors.textMuted }}>
                {t(`leaderboards.tier.${tier}`).toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export type TransformationEditorProps = {
  mode: 'coach' | 'client';
  clientFirstName: string | null;
  coachName?: string | null;
  /** Pre-fill when editing an existing card / submission. */
  initial?: Partial<TransformationCardInput> & { bodyFatLostPct?: number | null; leanMassGainedKg?: number | null };
  onSave: (input: TransformationCardInput) => Promise<void>;
  saveLabel: string;
  /** Override the photo pick (e.g. the client's "upload OR reuse a progress photo" sheet).
   *  Resolves to the new media id, or null if cancelled/failed. Default = direct library upload. */
  pickPhoto?: () => Promise<string | null>;
};

export function TransformationEditor({ mode, clientFirstName, coachName, initial, onSave, saveLabel, pickPhoto }: TransformationEditorProps) {
  const { t } = useTranslation();
  const toast = useToast();

  const [beforeMediaId, setBeforeMediaId] = useState<string | null>(initial?.beforeMediaId ?? null);
  const [afterMediaId, setAfterMediaId] = useState<string | null>(initial?.afterMediaId ?? null);
  const [beforeFrame, setBeforeFrame] = useState<PhotoFrame>(initial?.beforeFrame ?? DEFAULT_FRAME);
  const [afterFrame, setAfterFrame] = useState<PhotoFrame>(initial?.afterFrame ?? DEFAULT_FRAME);
  const [layout, setLayout] = useState<TransformationLayout>(initial?.layout ?? 'side');
  const [caption, setCaption] = useState(initial?.caption ?? '');
  const [bodyFatLost, setBodyFatLost] = useState(initial?.bodyFatLostPct != null ? String(initial.bodyFatLostPct) : '');
  const [leanMassGained, setLeanMassGained] = useState(initial?.leanMassGainedKg != null ? String(initial.leanMassGainedKg) : '');
  const [tierBefore, setTierBefore] = useState<TierId | null>(initial?.tierBeforeOverride ?? null);
  const [tierAfter, setTierAfter] = useState<TierId | null>(initial?.tierAfterOverride ?? null);
  const [beforeDate, setBeforeDate] = useState(initial?.measurementStartedAt ?? '');
  const [afterDate, setAfterDate] = useState(initial?.measurementEndedAt ?? '');
  const [uploading, setUploading] = useState<'before' | 'after' | null>(null);
  const [saving, setSaving] = useState(false);

  const pick = (which: 'before' | 'after') => async () => {
    setUploading(which);
    try {
      let mediaId: string | null = null;
      if (pickPhoto) {
        mediaId = await pickPhoto();
      } else {
        // No forced square: keep the full frame so the in-app framing editor has room to work.
        const res = await captureAndUploadPhoto({ source: 'library', kind: 'transformation' });
        if ('mediaId' in res) mediaId = res.mediaId;
        else if ('limited' in res) toast.show(t('transformationEditor.photoLimit'), 'error');
      }
      if (mediaId) {
        if (which === 'before') { setBeforeMediaId(mediaId); setBeforeFrame(DEFAULT_FRAME); }
        else { setAfterMediaId(mediaId); setAfterFrame(DEFAULT_FRAME); }
      }
    } catch {
      toast.show(t('transformationEditor.photoError'), 'error');
    } finally {
      setUploading(null);
    }
  };

  const bfBp = bodyFatLost.trim() && !Number.isNaN(Number(bodyFatLost)) ? Math.round(Number(bodyFatLost) * 100) : null;
  const lmGrams = leanMassGained.trim() && !Number.isNaN(Number(leanMassGained)) ? Math.round(Number(leanMassGained) * 1000) : null;
  const startDate = DATE_RE.test(beforeDate) ? beforeDate : null;
  const endDate = DATE_RE.test(afterDate) ? afterDate : null;
  const hasOverride = bfBp != null || lmGrams != null || tierBefore != null || tierAfter != null || !!startDate || !!endDate;

  // Live preview item (verified is optimistic here; the server is the source of truth on save).
  const previewItem: CoachTransformation = useMemo(
    () => ({
      transformation_id: 'preview',
      client_first_name: clientFirstName,
      caption: caption.trim() || null,
      before_media_id: beforeMediaId,
      after_media_id: afterMediaId,
      duration_weeks: weeksBetween(startDate, endDate),
      body_fat_delta_bp: bfBp,
      lean_mass_delta_grams: lmGrams,
      ffmi_before: null,
      ffmi_after: null,
      tier_before: tierBefore,
      tier_after: tierAfter,
      goal: null,
      verified: !hasOverride,
      layout,
      before_frame: beforeFrame,
      after_frame: afterFrame,
    }),
    [clientFirstName, caption, beforeMediaId, afterMediaId, startDate, endDate, bfBp, lmGrams, tierBefore, tierAfter, hasOverride, layout, beforeFrame, afterFrame],
  );

  const save = async () => {
    if (!beforeMediaId || !afterMediaId) {
      toast.show(t('transformationEditor.needBoth'), 'error');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        caption: caption.trim() || null,
        beforeMediaId,
        afterMediaId,
        durationWeeksOverride: null,
        bodyFatDeltaBpOverride: bfBp,
        leanMassDeltaGramsOverride: lmGrams,
        tierBeforeOverride: tierBefore,
        tierAfterOverride: tierAfter,
        measurementStartedAt: startDate,
        measurementEndedAt: endDate,
        layout,
        beforeFrame: beforeFrame.scale > 1.001 || beforeFrame.x !== 0 || beforeFrame.y !== 0 ? beforeFrame : null,
        afterFrame: afterFrame.scale > 1.001 || afterFrame.x !== 0 || afterFrame.y !== 0 ? afterFrame : null,
      });
    } catch {
      // A save failure at this point is almost always a stale session / RLS (media already
      // uploaded). Point the user at the fix rather than a generic error.
      toast.show(t('transformationEditor.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: theme.spacing.lg }}>
      {/* Photos + framing */}
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <PhotoFramePicker label={t('coachProfile.before')} mediaId={beforeMediaId} frame={beforeFrame} busy={uploading === 'before'} onPick={pick('before')} onFrame={setBeforeFrame} />
        <PhotoFramePicker label={t('coachProfile.after')} mediaId={afterMediaId} frame={afterFrame} busy={uploading === 'after'} onPick={pick('after')} onFrame={setAfterFrame} />
      </View>
      {beforeMediaId || afterMediaId ? (
        <Text variant="caption" muted style={textStart}>{t('transformationEditor.frameHint')}</Text>
      ) : null}

      {/* Layout */}
      <View style={{ gap: 6 }}>
        <Text variant="label" muted style={textStart}>{t('transformationEditor.layout')}</Text>
        <Segmented
          options={[
            { value: 'side', label: t('transformationEditor.layoutSide') },
            { value: 'stack', label: t('transformationEditor.layoutStack') },
          ]}
          value={layout}
          onChange={(v) => setLayout(v as TransformationLayout)}
        />
      </View>

      {/* Stats & dates */}
      <GlassCard style={{ gap: theme.spacing.md }}>
        <View style={{ gap: 2 }}>
          <Text variant="bodyStrong" style={textStart}>{t('transformationEditor.statsTitle')}</Text>
          <Text variant="caption" muted style={textStart}>{t('transformationEditor.statsHint')}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Input label={t('transformationEditor.bodyFatLost')} value={bodyFatLost} onChangeText={setBodyFatLost} keyboardType="numbers-and-punctuation" placeholder="8.4" mono />
          </View>
          <View style={{ flex: 1 }}>
            <Input label={t('transformationEditor.leanMassGained')} value={leanMassGained} onChangeText={setLeanMassGained} keyboardType="numbers-and-punctuation" placeholder="3.2" mono />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Input label={t('transformationEditor.beforeDate')} value={beforeDate} onChangeText={setBeforeDate} autoCapitalize="none" placeholder="2026-01-15" mono />
          </View>
          <View style={{ flex: 1 }}>
            <Input label={t('transformationEditor.afterDate')} value={afterDate} onChangeText={setAfterDate} autoCapitalize="none" placeholder="2026-04-15" mono />
          </View>
        </View>
        <TierRow label={t('coachProfile.tierBefore')} value={tierBefore} onChange={setTierBefore} />
        <TierRow label={t('coachProfile.tierAfter')} value={tierAfter} onChange={setTierAfter} />
      </GlassCard>

      <Input value={caption} onChangeText={setCaption} placeholder={t('coachProfile.captionPlaceholder')} maxLength={200} />

      {/* Verified / self-reported indicator */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={hasOverride ? 'pencil' : 'check-circle'} size={15} color={hasOverride ? theme.colors.textMuted : theme.colors.primary} />
        <Text variant="caption" color={hasOverride ? theme.colors.textMuted : theme.colors.primary} style={{ flex: 1 }}>
          {hasOverride ? t('transformationEditor.selfReportedHint') : t('transformationEditor.verifiedHint')}
        </Text>
      </View>

      {/* Live preview */}
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <Text variant="label" muted>{t('transformationEditor.preview')}</Text>
        <ShareableTransformationCard item={previewItem} coachName={coachName} shareable={false} />
      </View>

      <Button title={saveLabel} onPress={save} loading={saving} disabled={!beforeMediaId || !afterMediaId} />
      {mode === 'client' ? (
        <Text variant="caption" muted style={[textStart, { textAlign: 'center' }]}>{t('transformationEditor.clientSaveNote')}</Text>
      ) : null}
    </View>
  );
}

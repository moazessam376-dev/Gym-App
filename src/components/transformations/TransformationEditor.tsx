// TransformationEditor — the shared card authoring surface (coach card + client submission).
// 0087: a card holds 2–4 PHOTO SLOTS driven by the layout (side/stack/slider = 2, strip = 3,
// grid = 4), each slot framed (drag + zoom) with an optional taken-on date (strip/grid date
// chips). The VERIFIED path can pin two of the client's coach-verified InBody scans (coach
// mode) — picking scans clears the manual stats and vice-versa, so the card's data source is
// always unambiguous. Leaving every manual field blank keeps the card VERIFIED (numbers come
// from the client's verified body_metrics — picked scans or first/last); typing any stat,
// date or tier makes it SELF-REPORTED. The parent supplies onSave (the actual
// insert/update/submission). Module-scope sub-components get their OWN useTranslation.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { theme } from '@/theme';
import { textStart } from '@/lib/rtl';
import { TIER_COLORS, type TierId } from '@/lib/leagues';
import { frameStyle, MIN_FRAME_SCALE, MAX_FRAME_SCALE, type NaturalSize } from '@/lib/photoFrame';
import { createFrameGesture } from '@/lib/frameGestures';
import { captureAndUploadPhoto } from '@/lib/upload';
import { listBodyMetrics, type BodyMetric } from '@/lib/body-metrics';
import {
  LAYOUT_PHOTO_COUNT,
  type PhotoFrame,
  type TransformationCardInput,
  type TransformationLayout,
  type TransformationPhotoInput,
  type CoachTransformation,
} from '@/lib/public-profiles';
import { Button, GlassCard, Icon, Input, SignedImage, Text, useToast } from '@/components/ui';
import { ShareableTransformationCard } from '@/components/ShareableTransformationCard';
import { LAYOUT_LABEL_KEY } from './layoutLabels';

const TIERS = Object.keys(TIER_COLORS) as TierId[];
const DEFAULT_FRAME: PhotoFrame = { scale: 1, x: 0, y: 0 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COACH_LAYOUTS: TransformationLayout[] = ['side', 'stack', 'slider', 'strip', 'grid'];
const CLIENT_LAYOUTS: TransformationLayout[] = ['side', 'stack', 'slider'];

type PhotoSlot = { mediaId: string | null; takenOn: string; frame: PhotoFrame };

function weeksBetween(a: string | null, b: string | null): number | null {
  if (!a || !b || !DATE_RE.test(a) || !DATE_RE.test(b)) return null;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const t0 = new Date(ay, am - 1, ad).getTime();
  const t1 = new Date(by, bm - 1, bd).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) return null;
  return Math.floor((t1 - t0) / (7 * 86400_000));
}

/** timestamptz → its local 'YYYY-MM-DD' date part (scan → measurement date). */
function datePart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
  const [nat, setNat] = useState<NaturalSize | null>(null);
  const szRef = useRef(sz);
  szRef.current = sz;
  const natRef = useRef(nat);
  natRef.current = nat;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Pan + pinch-zoom; refuses ScrollView termination.
  const responder = useRef(
    createFrameGesture({
      frame: () => frameRef.current,
      size: () => szRef.current,
      nat: () => natRef.current,
      onFrame: (f) => onFrameRef.current(f),
    }),
  ).current;

  const zoom = (delta: number) =>
    onFrame({ ...frame, scale: Math.max(MIN_FRAME_SCALE, Math.min(MAX_FRAME_SCALE, Math.round((frame.scale + delta) * 100) / 100)) });

  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text variant="label" muted style={textStart}>{label}</Text>
      <View
        onLayout={(e) => setSz({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={{ width: '100%', aspectRatio: 1, borderRadius: theme.radii.md, overflow: 'hidden', backgroundColor: theme.colors.glass, borderWidth: 1, borderColor: theme.colors.glassBorder, alignItems: 'center', justifyContent: 'center' }}
        {...(mediaId ? responder.panHandlers : {})}
      >
        {mediaId ? (
          sz.w > 0 ? (
            <SignedImage mediaId={mediaId} resizeMode="cover" style={frameStyle(frame, sz.w, sz.h, nat)} onNaturalSize={(w, h) => setNat({ w, h })} />
          ) : (
            <SignedImage mediaId={mediaId} resizeMode="cover" style={{ width: '100%', height: '100%' }} onNaturalSize={(w, h) => setNat({ w, h })} />
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
          <Pressable onPress={onPick} hitSlop={8} style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="caption" muted>{t('transformationEditor.replacePhoto')}</Text>
          </Pressable>
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

// ── WhatsApp-style "Move & Scale" panel (shown while a card photo is selected) ─────
// A large drag surface with the CELL-shaped crop window outlined and the photo's
// overflow GHOSTED around it, so you can see what you're positioning against — the
// card cell itself updates live with the same frame state.
function MoveAndScale({
  mediaId,
  frame,
  cellW,
  cellH,
  onFrame,
  onActive,
}: {
  mediaId: string;
  frame: PhotoFrame;
  cellW: number;
  cellH: number;
  onFrame: (f: PhotoFrame) => void;
  onActive?: (active: boolean) => void;
}) {
  const [panelW, setPanelW] = useState(0);
  const [nat, setNat] = useState<NaturalSize | null>(null);

  const aspect = cellW > 0 && cellH > 0 ? cellW / cellH : 1;
  const maxW = panelW * 0.68;
  const maxH = 260;
  let cropW = maxW;
  let cropH = aspect > 0 ? maxW / aspect : maxW;
  if (cropH > maxH) {
    cropH = maxH;
    cropW = maxH * aspect;
  }
  const panelH = Math.round(Math.min(340, cropH + 72));
  const cropX = (panelW - cropW) / 2;
  const cropY = (panelH - cropH) / 2;

  const stateRef = useRef({ frame, cropW, cropH, nat });
  stateRef.current = { frame, cropW, cropH, nat };
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  const responder = useRef(
    createFrameGesture({
      frame: () => stateRef.current.frame,
      size: () => ({ w: stateRef.current.cropW, h: stateRef.current.cropH }),
      nat: () => stateRef.current.nat,
      onFrame: (f) => onFrameRef.current(f),
      onActive: (a) => onActiveRef.current?.(a),
    }),
  ).current;

  const g = frameStyle(frame, cropW, cropH, nat);
  const gLeft = typeof g.left === 'number' ? g.left : 0;
  const gTop = typeof g.top === 'number' ? g.top : 0;
  const gW = typeof g.width === 'number' ? g.width : cropW;
  const gH = typeof g.height === 'number' ? g.height : cropH;

  return (
    <View
      onLayout={(e) => setPanelW(e.nativeEvent.layout.width)}
      style={{ width: '100%', height: panelH, borderRadius: theme.radii.md, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: theme.colors.glassBorder }}
      {...responder.panHandlers}
    >
      {panelW > 0 && cropW > 0 ? (
        <>
          {/* Ghost: the whole photo at its frame position — the overflow you're hiding. */}
          <View pointerEvents="none" style={{ position: 'absolute', left: cropX + gLeft, top: cropY + gTop, width: gW, height: gH, opacity: 0.35 }}>
            <SignedImage mediaId={mediaId} resizeMode="cover" style={{ width: '100%', height: '100%' }} onNaturalSize={(w, h) => setNat({ w, h })} />
          </View>
          {/* Bright: exactly what the card cell shows. */}
          <View pointerEvents="none" style={{ position: 'absolute', left: cropX, top: cropY, width: cropW, height: cropH, overflow: 'hidden' }}>
            <SignedImage mediaId={mediaId} resizeMode="cover" style={frameStyle(frame, cropW, cropH, nat)} />
          </View>
          <View pointerEvents="none" style={{ position: 'absolute', left: cropX, top: cropY, width: cropW, height: cropH, borderWidth: 1.5, borderColor: theme.colors.primary }} />
        </>
      ) : null}
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

// ── Verified-scan chips (coach mode): pick one of the client's verified InBody scans ──
function ScanChips({
  label,
  scans,
  value,
  onChange,
  locale,
}: {
  label: string;
  scans: BodyMetric[];
  value: string | null;
  onChange: (id: string | null) => void;
  locale: string;
}) {
  const chipLabel = (m: BodyMetric) => {
    const d = new Date(m.measured_at);
    const date = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    const bf = m.body_fat_bp == null ? '' : ` · ${Math.round(m.body_fat_bp / 10) / 10}%`;
    return `${date}${bf}`;
  };
  return (
    <View style={{ gap: 4 }}>
      <Text variant="label" muted style={textStart}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {scans.map((m) => {
          const on = value === m.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => onChange(on ? null : m.id)}
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: theme.radii.sm, borderWidth: 1, borderColor: on ? theme.colors.primary : theme.colors.glassBorder, backgroundColor: on ? 'rgba(63,217,192,0.14)' : 'transparent' }}
            >
              <Text style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 11, color: on ? theme.colors.primary : theme.colors.textMuted }}>
                {chipLabel(m)}
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
  /** Coach mode: the featured client — enables the verified-scan picker. */
  clientId?: string | null;
  clientFirstName: string | null;
  coachName?: string | null;
  /** Pre-fill when editing an existing card / submission. */
  initial?: Partial<TransformationCardInput> & { bodyFatLostPct?: number | null; leanMassGainedKg?: number | null };
  onSave: (input: TransformationCardInput) => Promise<void>;
  saveLabel: string;
  /** Override the photo pick (e.g. the client's "upload OR reuse a progress photo" sheet).
   *  Resolves to the new media id, or null if cancelled/failed. Default = direct library upload. */
  pickPhoto?: () => Promise<string | null>;
  /** 'external' hides the inline preview — the parent renders it (desktop's sticky rail)
   *  from the live item streamed through onPreviewItem. */
  previewMode?: 'inline' | 'external';
  onPreviewItem?: (item: CoachTransformation) => void;
  /** A framing/slider drag is in progress — the host screen should freeze its ScrollView
   *  (scrollEnabled={!active}) so the drag doesn't scroll the page. */
  onGestureActive?: (active: boolean) => void;
};

function initialSlots(initial: TransformationEditorProps['initial'], count: number): PhotoSlot[] {
  const fromPhotos: PhotoSlot[] = (initial?.photos ?? []).map((p: TransformationPhotoInput) => ({
    mediaId: p.mediaId,
    takenOn: p.takenOn ?? '',
    frame: p.frame ?? DEFAULT_FRAME,
  }));
  const slots = fromPhotos.length > 0
    ? fromPhotos
    : [
        { mediaId: initial?.beforeMediaId ?? null, takenOn: '', frame: initial?.beforeFrame ?? DEFAULT_FRAME },
        { mediaId: initial?.afterMediaId ?? null, takenOn: '', frame: initial?.afterFrame ?? DEFAULT_FRAME },
      ];
  while (slots.length < count) slots.push({ mediaId: null, takenOn: '', frame: DEFAULT_FRAME });
  return slots.slice(0, Math.max(count, slots.length));
}

export function TransformationEditor({ mode, clientId, clientFirstName, coachName, initial, onSave, saveLabel, pickPhoto, previewMode = 'inline', onPreviewItem, onGestureActive }: TransformationEditorProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();

  const [layout, setLayout] = useState<TransformationLayout>(initial?.layout ?? 'side');
  const [slots, setSlots] = useState<PhotoSlot[]>(() => initialSlots(initial, LAYOUT_PHOTO_COUNT[initial?.layout ?? 'side']));
  const [caption, setCaption] = useState(initial?.caption ?? '');
  const [bodyFatLost, setBodyFatLost] = useState(initial?.bodyFatLostPct != null ? String(initial.bodyFatLostPct) : '');
  const [leanMassGained, setLeanMassGained] = useState(initial?.leanMassGainedKg != null ? String(initial.leanMassGainedKg) : '');
  const [tierBefore, setTierBefore] = useState<TierId | null>(initial?.tierBeforeOverride ?? null);
  const [tierAfter, setTierAfter] = useState<TierId | null>(initial?.tierAfterOverride ?? null);
  const [beforeDate, setBeforeDate] = useState(initial?.measurementStartedAt ?? '');
  const [afterDate, setAfterDate] = useState(initial?.measurementEndedAt ?? '');
  const [scanBeforeId, setScanBeforeId] = useState<string | null>(initial?.beforeMetricId ?? null);
  const [scanAfterId, setScanAfterId] = useState<string | null>(initial?.afterMetricId ?? null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Card-first editing (inline mode): the slot currently selected for reframing on the card.
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  // Measured card-cell sizes (Move & Scale matches the selected cell's aspect).
  const [cellSizes, setCellSizes] = useState<Record<number, { w: number; h: number }>>({});
  // Card presentation (0088): title placement + top-fade toggle.
  const [styleTitleBand, setStyleTitleBand] = useState(initial?.cardStyle?.title === 'band');
  const [styleScrim, setStyleScrim] = useState(initial?.cardStyle?.scrim !== false);

  const layouts = mode === 'coach' ? COACH_LAYOUTS : CLIENT_LAYOUTS;
  const slotCount = LAYOUT_PHOTO_COUNT[layout];
  const showTakenOn = layout === 'strip' || layout === 'grid';

  // Coach mode: the client's verified scans for the explicit pick (RLS: coach reads own clients).
  const scansQ = useQuery({
    queryKey: ['body-metrics', clientId],
    queryFn: () => listBodyMetrics(clientId as string),
    enabled: mode === 'coach' && !!clientId,
  });
  const scans = scansQ.data ?? [];
  const scanBefore = scans.find((m) => m.id === scanBeforeId) ?? null;
  const scanAfter = scans.find((m) => m.id === scanAfterId) ?? null;

  const changeLayout = (next: TransformationLayout) => {
    setLayout(next);
    const n = LAYOUT_PHOTO_COUNT[next];
    setSlots((prev) => {
      const copy = prev.slice(0, Math.max(n, prev.length));
      while (copy.length < n) copy.push({ mediaId: null, takenOn: '', frame: DEFAULT_FRAME });
      return copy;
    });
    setSelectedSlot((s) => (s != null && s >= n ? null : s));
  };

  const setSlot = (i: number, patch: Partial<PhotoSlot>) =>
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const pick = (i: number) => async () => {
    setUploading(i);
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
      if (mediaId) setSlot(i, { mediaId, frame: DEFAULT_FRAME });
    } catch {
      toast.show(t('transformationEditor.photoError'), 'error');
    } finally {
      setUploading(null);
    }
  };

  // Typing any manual stat/date clears the scan pick (one unambiguous data source);
  // picking a scan clears the manual stats + dates (tiers are an independent override).
  const onManualStat = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    if (v.trim()) {
      setScanBeforeId(null);
      setScanAfterId(null);
    }
  };
  const onScanPick = (setter: (id: string | null) => void) => (id: string | null) => {
    setter(id);
    if (id) {
      setBodyFatLost('');
      setLeanMassGained('');
      setBeforeDate('');
      setAfterDate('');
    }
  };

  const bfBp = bodyFatLost.trim() && !Number.isNaN(Number(bodyFatLost)) ? Math.round(Number(bodyFatLost) * 100) : null;
  const lmGrams = leanMassGained.trim() && !Number.isNaN(Number(leanMassGained)) ? Math.round(Number(leanMassGained) * 1000) : null;
  const startDate = DATE_RE.test(beforeDate) ? beforeDate : null;
  const endDate = DATE_RE.test(afterDate) ? afterDate : null;
  const hasOverride = bfBp != null || lmGrams != null || tierBefore != null || tierAfter != null || !!startDate || !!endDate;
  const hasScanPick = !!(scanBefore && scanAfter);

  // Live preview stats: manual overrides win; else picked scans compute locally (the same
  // math the RPC runs server-side); else blank (the server derives first/last on read).
  const previewStats = useMemo(() => {
    if (hasScanPick && !hasOverride && scanBefore && scanAfter) {
      const bf = scanBefore.body_fat_bp != null && scanAfter.body_fat_bp != null ? scanBefore.body_fat_bp - scanAfter.body_fat_bp : null;
      const lm =
        scanBefore.skeletal_muscle_mass_grams != null && scanAfter.skeletal_muscle_mass_grams != null
          ? scanAfter.skeletal_muscle_mass_grams - scanBefore.skeletal_muscle_mass_grams
          : null;
      return { bf, lm, weeks: weeksBetween(datePart(scanBefore.measured_at), datePart(scanAfter.measured_at)) };
    }
    return { bf: bfBp, lm: lmGrams, weeks: weeksBetween(startDate, endDate) };
  }, [hasScanPick, hasOverride, scanBefore, scanAfter, bfBp, lmGrams, startDate, endDate]);

  const previewItem: CoachTransformation = useMemo(
    () => ({
      transformation_id: 'preview',
      client_first_name: clientFirstName,
      caption: caption.trim() || null,
      before_media_id: slots[0]?.mediaId ?? null,
      after_media_id: slots[slotCount - 1]?.mediaId ?? null,
      duration_weeks: previewStats.weeks,
      body_fat_delta_bp: previewStats.bf,
      lean_mass_delta_grams: previewStats.lm,
      ffmi_before: null,
      ffmi_after: null,
      tier_before: tierBefore,
      tier_after: tierAfter,
      goal: null,
      verified: !hasOverride,
      layout,
      before_frame: slots[0]?.frame ?? null,
      after_frame: slots[slotCount - 1]?.frame ?? null,
      photos: slots.slice(0, slotCount).map((s, i) => ({
        media_id: s.mediaId,
        taken_on: DATE_RE.test(s.takenOn) ? s.takenOn : null,
        frame: s.frame,
        position: i,
      })),
      style: { scrim: styleScrim, title: styleTitleBand ? 'band' : 'top' },
    }),
    [clientFirstName, caption, slots, slotCount, previewStats, tierBefore, tierAfter, hasOverride, layout, styleScrim, styleTitleBand],
  );

  const onPreviewItemRef = useRef(onPreviewItem);
  onPreviewItemRef.current = onPreviewItem;
  useEffect(() => {
    onPreviewItemRef.current?.(previewItem);
  }, [previewItem]);

  const save = async () => {
    const active = slots.slice(0, slotCount);
    if (active.some((s) => !s.mediaId)) {
      toast.show(slotCount === 2 ? t('transformationEditor.needBoth') : t('transformationEditor.photosNeeded', { count: slotCount }), 'error');
      return;
    }
    setSaving(true);
    try {
      const photos: TransformationPhotoInput[] = active.map((s) => ({
        mediaId: s.mediaId,
        takenOn: DATE_RE.test(s.takenOn) ? s.takenOn : null,
        frame: s.frame.scale > 1.001 || s.frame.x !== 0 || s.frame.y !== 0 ? s.frame : null,
      }));
      await onSave({
        caption: caption.trim() || null,
        beforeMediaId: photos[0].mediaId,
        afterMediaId: photos[photos.length - 1].mediaId,
        durationWeeksOverride: null,
        bodyFatDeltaBpOverride: bfBp,
        leanMassDeltaGramsOverride: lmGrams,
        tierBeforeOverride: tierBefore,
        tierAfterOverride: tierAfter,
        measurementStartedAt: startDate,
        measurementEndedAt: endDate,
        layout,
        beforeFrame: photos[0].frame,
        afterFrame: photos[photos.length - 1].frame,
        photos,
        beforeMetricId: scanBeforeId,
        afterMetricId: scanAfterId,
        // Store null for the defaults so untouched rows stay clean.
        cardStyle: !styleScrim || styleTitleBand ? { scrim: styleScrim, title: styleTitleBand ? 'band' : 'top' } : null,
      });
    } catch {
      // A save failure at this point is almost always a stale session / RLS (media already
      // uploaded). Point the user at the fix rather than a generic error.
      toast.show(t('transformationEditor.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Photo slots render in rows of two (comfortable framing width on phones).
  const slotRows: number[][] = [];
  for (let i = 0; i < slotCount; i += 2) slotRows.push(slotCount - i === 1 ? [i] : [i, i + 1]);
  const anyPhoto = slots.slice(0, slotCount).some((s) => s.mediaId);

  const slotLabel = (i: number) => {
    if (i === 0) return t('coachProfile.before');
    if (i === slotCount - 1) return t('coachProfile.after');
    return t('transformationEditor.photoN', { n: i + 1 });
  };

  return (
    <View style={{ gap: theme.spacing.lg }}>
      {/* Layout — drives how many photo slots the card has */}
      <View style={{ gap: 6 }}>
        <Text variant="label" muted style={textStart}>{t('transformationEditor.layout')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {layouts.map((l) => {
            const on = layout === l;
            return (
              <Pressable
                key={l}
                onPress={() => changeLayout(l)}
                style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: theme.radii.sm, borderWidth: 1, borderColor: on ? theme.colors.primary : theme.colors.glassBorder, backgroundColor: on ? theme.colors.primary : 'transparent' }}
              >
                <Text style={{ fontFamily: theme.fontFamily.bodySemiBold, fontSize: 13, color: on ? theme.colors.onPrimary : theme.colors.textMuted }}>
                  {t(LAYOUT_LABEL_KEY[l])}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Card style (0088): title placement (the top overlay can cover a face at Square/
          Portrait) + the top fade as an option, not a mandate. */}
      <View style={{ gap: 6 }}>
        <Text variant="label" muted style={textStart}>{t('transformationEditor.cardStyleTitle')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {[false, true].map((band) => {
            const on = styleTitleBand === band;
            return (
              <Pressable
                key={String(band)}
                onPress={() => setStyleTitleBand(band)}
                style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: theme.radii.sm, borderWidth: 1, borderColor: on ? theme.colors.primary : theme.colors.glassBorder, backgroundColor: on ? theme.colors.primary : 'transparent' }}
              >
                <Text style={{ fontFamily: theme.fontFamily.bodySemiBold, fontSize: 13, color: on ? theme.colors.onPrimary : theme.colors.textMuted }}>
                  {band ? t('transformationEditor.titleBelow') : t('transformationEditor.titleOnPhoto')}
                </Text>
              </Pressable>
            );
          })}
          {!styleTitleBand ? (
            <Pressable
              onPress={() => setStyleScrim((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 13, borderRadius: theme.radii.sm, borderWidth: 1, borderColor: styleScrim ? theme.colors.primary : theme.colors.glassBorder, backgroundColor: styleScrim ? 'rgba(63,217,192,0.14)' : 'transparent' }}
            >
              {styleScrim ? <Icon name="check" size={13} color={theme.colors.primary} /> : null}
              <Text style={{ fontFamily: theme.fontFamily.bodySemiBold, fontSize: 13, color: styleScrim ? theme.colors.primary : theme.colors.textMuted }}>
                {t('transformationEditor.topFade')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Photos. INLINE mode: the live card IS the editing surface — tap a cell to add or
          select a photo, drag on the card to reframe it (WYSIWYG, no scroll-to-preview).
          EXTERNAL mode (desktop): the slot grid; the parent shows the live card in a rail. */}
      {previewMode === 'inline' ? (
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ alignItems: 'center' }}>
            <ShareableTransformationCard
              item={previewItem}
              coachName={coachName}
              shareable={false}
              edit={{
                selected: selectedSlot,
                busySlot: uploading,
                onSelect: (i) => setSelectedSlot((s) => (s === i ? null : i)),
                onPick: (i) => void pick(i)(),
                onFrame: (i, f) => setSlot(i, { frame: f }),
                onCellLayout: (i, s) =>
                  setCellSizes((prev) => {
                    const cur = prev[i];
                    if (cur && Math.abs(cur.w - s.w) < 1 && Math.abs(cur.h - s.h) < 1) return prev;
                    return { ...prev, [i]: s };
                  }),
                onGestureActive,
              }}
            />
          </View>
          {selectedSlot != null ? (
            <View style={{ gap: theme.spacing.sm }}>
              {/* WhatsApp-style Move & Scale: the crop window with the photo's overflow
                  ghosted around it — a big drag surface; the card cell updates live too. */}
              {slots[selectedSlot]?.mediaId ? (
                <MoveAndScale
                  mediaId={slots[selectedSlot]!.mediaId!}
                  frame={slots[selectedSlot]!.frame}
                  cellW={cellSizes[selectedSlot]?.w ?? 1}
                  cellH={cellSizes[selectedSlot]?.h ?? 1}
                  onFrame={(f) => setSlot(selectedSlot, { frame: f })}
                  onActive={onGestureActive}
                />
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Text variant="label" muted style={[{ flex: 1 }, textStart]}>{slotLabel(selectedSlot)}</Text>
                <Pressable onPress={() => { const s = slots[selectedSlot]; if (s) setSlot(selectedSlot, { frame: { ...s.frame, scale: Math.max(MIN_FRAME_SCALE, Math.round((s.frame.scale - 0.25) * 100) / 100) } }); }} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
                  <Text variant="title" color={theme.colors.text}>−</Text>
                </Pressable>
                <Pressable onPress={() => { const s = slots[selectedSlot]; if (s) setSlot(selectedSlot, { frame: { ...s.frame, scale: Math.min(MAX_FRAME_SCALE, Math.round((s.frame.scale + 0.25) * 100) / 100) } }); }} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
                  <Text variant="title" color={theme.colors.text}>+</Text>
                </Pressable>
                <Pressable onPress={() => setSlot(selectedSlot, { frame: DEFAULT_FRAME })} hitSlop={8}>
                  <Text variant="caption" muted>{t('transformationEditor.resetFrame')}</Text>
                </Pressable>
                <Pressable onPress={() => void pick(selectedSlot)()} hitSlop={8}>
                  <Text variant="caption" muted>{t('transformationEditor.replacePhoto')}</Text>
                </Pressable>
                <Pressable onPress={() => setSelectedSlot(null)} hitSlop={8} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: theme.radii.sm, backgroundColor: theme.colors.primary }}>
                  <Text style={{ fontFamily: theme.fontFamily.bodySemiBold, fontSize: 13, color: theme.colors.onPrimary }}>{t('transformationEditor.editDone')}</Text>
                </Pressable>
              </View>
              {showTakenOn ? (
                <Input
                  label={t('transformationEditor.takenOn')}
                  value={slots[selectedSlot]?.takenOn ?? ''}
                  onChangeText={(v) => setSlot(selectedSlot, { takenOn: v })}
                  autoCapitalize="none"
                  placeholder="2026-01-15"
                  mono
                />
              ) : null}
              <Text variant="caption" muted style={textStart}>{t('transformationEditor.dragHint')}</Text>
            </View>
          ) : (
            <Text variant="caption" muted style={{ textAlign: 'center' }}>{t('transformationEditor.tapToEditHint')}</Text>
          )}
        </View>
      ) : (
        <>
          <View style={{ gap: theme.spacing.md }}>
            {slotRows.map((row) => (
              <View key={row[0]} style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                {row.map((i) => (
                  <View key={i} style={{ flex: 1, gap: 6 }}>
                    <PhotoFramePicker
                      label={slotLabel(i)}
                      mediaId={slots[i]?.mediaId ?? null}
                      frame={slots[i]?.frame ?? DEFAULT_FRAME}
                      busy={uploading === i}
                      onPick={pick(i)}
                      onFrame={(f) => setSlot(i, { frame: f })}
                    />
                    {showTakenOn ? (
                      <Input
                        label={t('transformationEditor.takenOn')}
                        value={slots[i]?.takenOn ?? ''}
                        onChangeText={(v) => setSlot(i, { takenOn: v })}
                        autoCapitalize="none"
                        placeholder="2026-01-15"
                        mono
                      />
                    ) : null}
                  </View>
                ))}
                {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
              </View>
            ))}
          </View>
          {anyPhoto ? (
            <Text variant="caption" muted style={textStart}>{t('transformationEditor.frameHint')}</Text>
          ) : null}
        </>
      )}

      {/* Stats & dates */}
      <GlassCard style={{ gap: theme.spacing.md }}>
        <View style={{ gap: 2 }}>
          <Text variant="bodyStrong" style={textStart}>{t('transformationEditor.statsTitle')}</Text>
          <Text variant="caption" muted style={textStart}>{t('transformationEditor.statsHint')}</Text>
        </View>

        {/* Coach mode: pin the verified numbers to two explicit InBody scans. */}
        {mode === 'coach' && scans.length >= 2 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <ScanChips label={t('transformationEditor.scanBefore')} scans={scans} value={scanBeforeId} onChange={onScanPick(setScanBeforeId)} locale={i18n.language} />
            <ScanChips label={t('transformationEditor.scanAfter')} scans={scans} value={scanAfterId} onChange={onScanPick(setScanAfterId)} locale={i18n.language} />
            {hasScanPick && previewStats.bf != null ? (
              <View style={{ backgroundColor: 'rgba(63,217,192,0.08)', borderRadius: theme.radii.sm, paddingVertical: 9, paddingHorizontal: 11 }}>
                <Text style={{ fontFamily: theme.fontFamily.monoRegular, fontSize: 12.5, color: theme.colors.primary }}>
                  {t('transformationEditor.scanReadout', {
                    bf: Math.abs((previewStats.bf ?? 0) / 100).toFixed(1),
                    lm: Math.abs((previewStats.lm ?? 0) / 1000).toFixed(1),
                    weeks: previewStats.weeks ?? 0,
                  })}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Input label={t('transformationEditor.bodyFatLost')} value={bodyFatLost} onChangeText={onManualStat(setBodyFatLost)} keyboardType="numbers-and-punctuation" placeholder="8.4" mono />
          </View>
          <View style={{ flex: 1 }}>
            <Input label={t('transformationEditor.leanMassGained')} value={leanMassGained} onChangeText={onManualStat(setLeanMassGained)} keyboardType="numbers-and-punctuation" placeholder="3.2" mono />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Input label={t('transformationEditor.beforeDate')} value={beforeDate} onChangeText={onManualStat(setBeforeDate)} autoCapitalize="none" placeholder="2026-01-15" mono />
          </View>
          <View style={{ flex: 1 }}>
            <Input label={t('transformationEditor.afterDate')} value={afterDate} onChangeText={onManualStat(setAfterDate)} autoCapitalize="none" placeholder="2026-04-15" mono />
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

      {/* Inline mode's live preview IS the editable card above; desktop renders it in the rail. */}

      <Button title={saveLabel} onPress={save} loading={saving} disabled={slots.slice(0, slotCount).some((s) => !s.mediaId)} />
      {mode === 'client' ? (
        <Text variant="caption" muted style={[textStart, { textAlign: 'center' }]}>{t('transformationEditor.clientSaveNote')}</Text>
      ) : null}
    </View>
  );
}

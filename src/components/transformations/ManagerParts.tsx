// Shared presentational pieces of the Transformation Manager (0087) — used by BOTH the
// mobile screen and the desktop portal view. Module-scope components → each gets its OWN
// useTranslation (i18n rule).
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { theme } from '@/theme';
import { textStart } from '@/lib/rtl';
import { relativeTimeParts } from '@/lib/notifications';
import type { MyTransformation } from '@/lib/coach-transformations';
import type { PendingSubmission } from '@/lib/transformation-submissions';
import type { CoachTransformation, TransformationLayout, TransformationPhoto } from '@/lib/public-profiles';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Badge, Button, Icon, SignedImage, Text } from '@/components/ui';
import { LAYOUT_LABEL_KEY } from './layoutLabels';

/** Tiny mono chip (VERIFIED / SELF / layout) — the thumbnail metadata row. */
function MetaChip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 5, paddingVertical: 2, paddingHorizontal: 6 }}>
      <Text style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 8, letterSpacing: 0.5, color }}>{label}</Text>
    </View>
  );
}

/** Static mini photo hero for thumbnails — same cell arrangement as the card, no frames
 *  (thumbs are too small for the crop to read) and slider renders as a 50/50 side pair. */
export function ThumbHero({ photos, layout, height }: { photos: TransformationPhoto[]; layout: TransformationLayout; height: number }) {
  const cell = (p: TransformationPhoto | null, key: number) => (
    <View key={key} style={{ flex: 1, backgroundColor: theme.colors.surface, overflow: 'hidden' }}>
      {p?.media_id ? <SignedImage mediaId={p.media_id} resizeMode="cover" style={{ width: '100%', height: '100%' }} /> : null}
    </View>
  );
  const vDivider = <View style={{ width: 2, backgroundColor: theme.colors.primary }} />;
  const hDivider = <View style={{ height: 2, backgroundColor: theme.colors.primary }} />;
  const at = (i: number) => photos[i] ?? null;

  if (layout === 'stack') {
    return (
      <View style={{ height }}>
        {cell(at(0), 0)}
        {hDivider}
        {cell(at(1), 1)}
      </View>
    );
  }
  if (layout === 'strip') {
    return (
      <View style={{ height, flexDirection: 'row' }}>
        {cell(at(0), 0)}
        {vDivider}
        {cell(at(1), 1)}
        {vDivider}
        {cell(at(2), 2)}
      </View>
    );
  }
  if (layout === 'grid') {
    return (
      <View style={{ height }}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {cell(at(0), 0)}
          {vDivider}
          {cell(at(1), 1)}
        </View>
        {hDivider}
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {cell(at(2), 2)}
          {vDivider}
          {cell(at(3), 3)}
        </View>
      </View>
    );
  }
  // side + slider (a slider thumb is just the pair at 50/50)
  return (
    <View style={{ height, flexDirection: 'row' }}>
      {cell(at(0), 0)}
      {vDivider}
      {cell(at(1), 1)}
    </View>
  );
}

/** One card thumbnail in a client's timeline — tap to edit. */
export function CardThumb({
  row,
  card,
  width = 170,
  onPress,
}: {
  row: MyTransformation;
  card: CoachTransformation | undefined;
  width?: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const weeks = card?.duration_weeks;
  const layoutLabel = t(LAYOUT_LABEL_KEY[row.layout]).toUpperCase();
  return (
    <Pressable
      onPress={onPress}
      style={{ width, borderRadius: theme.radii.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceElevated, borderWidth: 1, borderColor: theme.colors.glassBorder }}
    >
      <ThumbHero photos={row.photos} layout={row.layout} height={Math.round(width * 0.58)} />
      <View style={{ paddingVertical: 9, paddingHorizontal: 11, gap: 6 }}>
        <Text style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 12, color: theme.colors.text }}>
          {weeks != null ? t('coachProfile.weeksShort', { count: weeks }) : layoutLabel}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {card?.verified ? (
            <MetaChip label={t('coachProfile.verified').toUpperCase()} color={theme.colors.primary} bg="rgba(63,217,192,0.14)" />
          ) : (
            <MetaChip label={t('transformationManager.selfChip').toUpperCase()} color={theme.colors.textMuted} bg={theme.colors.surface} />
          )}
          <MetaChip label={layoutLabel} color={theme.colors.textMuted} bg={theme.colors.surface} />
        </View>
      </View>
    </Pressable>
  );
}

/** The dashed "add card" tile at the end of a client's timeline. */
export function AddCardTile({ width = 170, minHeight = 140, onPress }: { width?: number; minHeight?: number; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      style={{ width, minHeight, borderRadius: theme.radii.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.glassBorder, alignItems: 'center', justifyContent: 'center', gap: 6 }}
    >
      <Icon name="plus" size={20} color={theme.colors.textMuted} />
      <Text variant="caption" muted>{t('transformationManager.addCard')}</Text>
    </Pressable>
  );
}

/** One pending client submission — approve features it, dismiss clears it. */
export function PendingSubmissionCard({
  sub,
  busy,
  disabled,
  onApprove,
  onDismiss,
}: {
  sub: PendingSubmission;
  busy: boolean;
  disabled: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const sent = relativeTimeParts(sub.created_at);
  return (
    <View style={{ backgroundColor: theme.colors.surfaceElevated, borderWidth: 1, borderColor: theme.colors.primary, borderRadius: theme.radii.lg, padding: theme.spacing.lg, gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <ProfileAvatar name={sub.client_name} avatarMediaId={sub.client_avatar_media_id} size={28} />
        <Text variant="bodyStrong" style={[{ flex: 1 }, textStart]}>{sub.client_name ?? ''}</Text>
        <Badge label={t('clientTransformation.status.pending')} tone="warning" />
      </View>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {sub.before_media_id ? <SignedImage mediaId={sub.before_media_id} style={{ flex: 1, height: 104, borderRadius: theme.radii.sm }} /> : null}
        {sub.after_media_id ? <SignedImage mediaId={sub.after_media_id} style={{ flex: 1, height: 104, borderRadius: theme.radii.sm }} /> : null}
      </View>
      {sub.caption ? (
        <Text variant="caption" muted style={[textStart, { fontStyle: 'italic' }]}>“{sub.caption}”</Text>
      ) : null}
      <Text style={[{ fontFamily: theme.fontFamily.monoRegular, fontSize: 10.5, color: theme.colors.textMuted }, textStart]}>
        {t('transformationManager.sentLabel', { when: t(sent.key, { n: sent.count }) }).toUpperCase()}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Button title={t('coachProfile.approveFeature')} onPress={onApprove} loading={busy} disabled={disabled} style={{ flex: 1 }} />
        <Button title={t('coachProfile.dismiss')} variant="secondary" onPress={onDismiss} disabled={disabled} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

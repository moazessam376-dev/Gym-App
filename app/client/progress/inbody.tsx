// InBody scan capture + history (secure media pipeline, migration 0013, kind=inbody).
// Users photograph the printed InBody sheet; it's uploaded via the same EXIF-strip +
// signed-URL pipeline as progress photos. Phase 12b adds "Auto-read with AI": the
// inbody-ocr Edge Function reads the numbers with a vision model and stages an
// UNVERIFIED body_metrics row that the COACH confirms (the anti-cheat anchor — foundations
// §4). Each scan shows its OCR state. Read-only for a coach (?clientId=).
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { listMediaFor, type Media } from '../../../src/lib/media';
import { listMetricLinksFor, type MediaMetricLink } from '../../../src/lib/body-metrics';
import { requestInBodyOcr, type OcrStatus } from '../../../src/lib/inbody-ocr';
import { captureAndUploadPhoto, type PickSource } from '../../../src/lib/upload';
import { Screen, Text, Button, GlassCard, SignedImage, EmptyState } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// User-facing message for each OCR outcome (generic; no internal detail — §4).
const OCR_MESSAGE: Record<OcrStatus, string> = {
  extracted: 'Reading saved — your coach will review and confirm the numbers.',
  already_extracted: 'This scan has already been read.',
  not_readable: 'Couldn’t read this as an InBody sheet. Your coach can enter it manually.',
  rate_limited: 'You’ve reached the hourly limit for auto-reads. Please try again later.',
  unsupported_type: 'PDF scans are entered by your coach manually.',
  failed: 'Couldn’t read this scan. Please try again, or ask your coach to enter it.',
};

export default function InBodyScans() {
  const { role, session } = useAuth();
  const router = useRouter();
  const selfId = session?.user?.id;
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const ownerId = clientId ?? selfId;
  const readOnly = !!clientId && clientId !== selfId;

  const [scans, setScans] = useState<Media[]>([]);
  const [links, setLinks] = useState<Record<string, MediaMetricLink>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      const [media, metricLinks] = await Promise.all([
        listMediaFor(ownerId, 'inbody'),
        listMetricLinksFor(ownerId),
      ]);
      setScans(media);
      setLinks(Object.fromEntries(metricLinks.map((l) => [l.media_id, l])));
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role === 'admin') return <Redirect href="/" />;

  async function add(source: PickSource) {
    setNotice(null);
    setUploading(true);
    try {
      const res = await captureAndUploadPhoto({ source, kind: 'inbody' });
      if ('mediaId' in res) await load();
      else if ('denied' in res) setNotice('Permission denied. Enable photo/camera access in Settings.');
    } catch {
      setNotice('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function autoRead(mediaId: string) {
    setNotice(null);
    setOcrBusyId(mediaId);
    try {
      const res = await requestInBodyOcr(mediaId);
      setNotice(OCR_MESSAGE[res.status]);
      await load();
    } catch {
      setNotice(OCR_MESSAGE.failed);
    } finally {
      setOcrBusyId(null);
    }
  }

  function openScan(id: string) {
    router.push({ pathname: '/client/progress/view', params: { mediaId: id } });
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <FlatList
        data={loading ? [] : scans}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
            <Text variant="h2">InBody scans</Text>
            {!readOnly ? (
              <GlassCard style={{ gap: theme.spacing.sm }}>
                <Text variant="caption" muted>
                  Snap a photo of your InBody result sheet, then tap “Auto-read” to fill in the
                  numbers. The scan is sent to our AI reader to extract the values; your coach
                  reviews and confirms them before they count.
                </Text>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <Button
                    title="Camera"
                    variant="secondary"
                    style={{ flex: 1 }}
                    disabled={uploading}
                    onPress={() => add('camera')}
                    left={<Ionicons name="camera" size={18} color={theme.colors.text} />}
                  />
                  <Button
                    title="Library"
                    variant="secondary"
                    style={{ flex: 1 }}
                    disabled={uploading}
                    onPress={() => add('library')}
                    left={<Ionicons name="images" size={18} color={theme.colors.text} />}
                  />
                </View>
                {uploading ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <ActivityIndicator color={theme.colors.primary} />
                    <Text variant="caption" muted>
                      Uploading…
                    </Text>
                  </View>
                ) : null}
              </GlassCard>
            ) : null}
            {notice ? (
              <Text variant="caption" muted>
                {notice}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
          ) : (
            <EmptyState
              icon="document-text-outline"
              title="No scans yet"
              subtitle={readOnly ? 'This client hasn’t added an InBody scan yet.' : 'Add your first InBody scan to track body composition.'}
            />
          )
        }
        renderItem={({ item }) => {
          const link = links[item.id];
          return (
            <GlassCard padded={false} style={{ overflow: 'hidden' }}>
              <Pressable onPress={() => openScan(item.id)}>
                <SignedImage mediaId={item.id} style={{ width: '100%', height: 200 }} resizeMode="cover" />
                <View style={{ padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <Ionicons name="document-text" size={18} color={theme.colors.primary} />
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {longDate(item.created_at)}
                  </Text>
                  <Ionicons name="expand-outline" size={18} color={theme.colors.textMuted} />
                </View>
              </Pressable>
              {/* OCR state / action — separate region so it doesn't trigger the viewer */}
              <View
                style={{
                  paddingHorizontal: theme.spacing.md,
                  paddingBottom: theme.spacing.md,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                  paddingTop: theme.spacing.md,
                }}
              >
                {link?.verified ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
                    <Text variant="caption" color="success">
                      Confirmed by your coach
                    </Text>
                  </View>
                ) : link ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Ionicons name="hourglass-outline" size={18} color={theme.colors.warning} />
                    <Text variant="caption" muted>
                      Read — awaiting coach review
                    </Text>
                  </View>
                ) : readOnly ? (
                  <Text variant="caption" muted>
                    Not read yet
                  </Text>
                ) : (
                  <Button
                    title="Auto-read with AI"
                    variant="secondary"
                    fullWidth={false}
                    loading={ocrBusyId === item.id}
                    disabled={ocrBusyId != null}
                    onPress={() => autoRead(item.id)}
                    left={<Ionicons name="sparkles" size={16} color={theme.colors.text} />}
                  />
                )}
              </View>
            </GlassCard>
          );
        }}
      />
    </Screen>
  );
}

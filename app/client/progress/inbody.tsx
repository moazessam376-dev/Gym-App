// InBody scans (secure media pipeline, migration 0013, kind=inbody).
//
// Athlete: uploads the printed InBody sheet (one per day — Phase 12b), then waits for the
// coach. They do NOT trigger the AI read (it's a coach tool) and they see the coach's
// comments on each reading once posted.
// Coach (?clientId=): reviews the client's scans and triggers "Read with AI" → the
// inbody-ocr function stages an unverified reading → the coach confirms it. The anti-cheat
// anchor (foundations §4) is unchanged: only coach-confirmed numbers feed ranks/progress.
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { countInbodyToday, listMediaFor, type Media } from '../../../src/lib/media';
import {
  listCommentsForMetrics,
  listMetricLinksFor,
  type MediaMetricLink,
  type MetricComment,
} from '../../../src/lib/body-metrics';
import { requestInBodyOcr, type OcrStatus } from '../../../src/lib/inbody-ocr';
import { captureAndUploadPhoto, type PickSource } from '../../../src/lib/upload';
import { Icon, Screen, Text, Button, GlassCard, SignedImage, EmptyState } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Coach-facing messages for the AI read outcomes that don't navigate onward.
const COACH_OCR_MESSAGE: Partial<Record<OcrStatus, string>> = {
  not_readable: 'Couldn’t read this as an InBody sheet — enter the numbers manually.',
  unsupported_type: 'This is a PDF — enter the numbers manually (auto-read supports photos).',
  rate_limited: 'AI read limit reached for now. Please try again shortly.',
  failed: 'Couldn’t read this scan. Try again, or enter the numbers manually.',
};

function CommentList({ comments }: { comments: MetricComment[] }) {
  if (comments.length === 0) return null;
  return (
    <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
      {comments.map((c) => (
        <View key={c.id} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Icon name="chatbubble-ellipses" size={16} color={theme.colors.primary} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text variant="body">{c.body}</Text>
            <Text variant="label" muted style={{ fontSize: 10, marginTop: 2 }}>
              COACH ·{' '}
              {new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function InBodyScans() {
  const { role, session } = useAuth();
  const router = useRouter();
  const selfId = session?.user?.id;
  const { clientId, clientName } = useLocalSearchParams<{ clientId?: string; clientName?: string }>();
  const ownerId = clientId ?? selfId;
  const isCoachView = !!clientId && clientId !== selfId;

  const [scans, setScans] = useState<Media[]>([]);
  const [links, setLinks] = useState<Record<string, MediaMetricLink>>({});
  const [comments, setComments] = useState<Record<string, MetricComment[]>>({});
  const [todayCount, setTodayCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      const [media, metricLinks, today] = await Promise.all([
        listMediaFor(ownerId, 'inbody'),
        listMetricLinksFor(ownerId),
        isCoachView ? Promise.resolve(0) : countInbodyToday(ownerId),
      ]);
      setScans(media);
      setLinks(Object.fromEntries(metricLinks.map((l) => [l.media_id, l])));
      setTodayCount(today);
      const ids = metricLinks.map((l) => l.metric_id);
      const cs = await listCommentsForMetrics(ids);
      const byMetric: Record<string, MetricComment[]> = {};
      for (const c of cs) (byMetric[c.metric_id] ??= []).push(c);
      // Re-key comments by media_id so the scan card can look them up directly.
      const byMedia: Record<string, MetricComment[]> = {};
      for (const l of metricLinks) if (byMetric[l.metric_id]) byMedia[l.media_id] = byMetric[l.metric_id]!;
      setComments(byMedia);
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [ownerId, isCoachView]);

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
      else if ('limited' in res) {
        setNotice('You’ve already submitted today’s InBody. Come back tomorrow for your next one.');
        await load();
      } else if ('denied' in res) setNotice('Permission denied. Enable photo/camera access in Settings.');
    } catch {
      setNotice('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  // Coach: trigger the AI read, then go straight to the confirm screen with the result.
  async function readWithAi(mediaId: string) {
    setNotice(null);
    setOcrBusyId(mediaId);
    try {
      const res = await requestInBodyOcr(mediaId);
      if ((res.status === 'extracted' || res.status === 'already_extracted') && res.metric_id) {
        await load();
        router.push({
          pathname: '/coach/body-metric',
          params: { metricId: res.metric_id, clientId: ownerId ?? '', clientName: clientName ?? '' },
        });
      } else {
        setNotice(COACH_OCR_MESSAGE[res.status] ?? 'Couldn’t read this scan.');
      }
    } catch {
      setNotice(COACH_OCR_MESSAGE.failed!);
    } finally {
      setOcrBusyId(null);
    }
  }

  function openConfirm(metricId: string) {
    router.push({
      pathname: '/coach/body-metric',
      params: { metricId, clientId: ownerId ?? '', clientName: clientName ?? '' },
    });
  }

  const submittedToday = !isCoachView && todayCount > 0;

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <FlatList
        data={loading ? [] : scans}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
            <Text variant="h2">InBody scans</Text>
            {!isCoachView ? (
              <GlassCard style={{ gap: theme.spacing.sm }}>
                {submittedToday ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Icon name="checkmark-circle" size={18} color={theme.colors.success} />
                    <Text variant="caption" muted style={{ flex: 1 }}>
                      You’ve submitted today’s InBody — your coach will review it. Come back tomorrow for your next one.
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text variant="caption" muted>
                      Submit your latest InBody result sheet (one per day). Your coach reads and reviews it.
                    </Text>
                    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                      <Button
                        title="Camera"
                        variant="secondary"
                        style={{ flex: 1 }}
                        disabled={uploading}
                        onPress={() => add('camera')}
                        left={<Icon name="camera" size={18} color={theme.colors.text} />}
                      />
                      <Button
                        title="Library"
                        variant="secondary"
                        style={{ flex: 1 }}
                        disabled={uploading}
                        onPress={() => add('library')}
                        left={<Icon name="images" size={18} color={theme.colors.text} />}
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
                  </>
                )}
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
              subtitle={isCoachView ? 'This client hasn’t added an InBody scan yet.' : 'Add your first InBody scan to track body composition.'}
            />
          )
        }
        renderItem={({ item }) => {
          const link = links[item.id];
          const scanComments = comments[item.id] ?? [];
          return (
            <GlassCard padded={false} style={{ overflow: 'hidden' }}>
              <Pressable onPress={() => router.push({ pathname: '/client/progress/view', params: { mediaId: item.id } })}>
                <SignedImage mediaId={item.id} style={{ width: '100%', height: 200 }} resizeMode="cover" />
                <View style={{ padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <Icon name="document-text" size={18} color={theme.colors.primary} />
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {longDate(item.created_at)}
                  </Text>
                  <Icon name="expand-outline" size={18} color={theme.colors.textMuted} />
                </View>
              </Pressable>

              <View
                style={{
                  paddingHorizontal: theme.spacing.md,
                  paddingBottom: theme.spacing.md,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                  paddingTop: theme.spacing.md,
                }}
              >
                {isCoachView ? (
                  link?.verified ? (
                    <Button
                      title="Reviewed · open"
                      variant="secondary"
                      fullWidth={false}
                      onPress={() => openConfirm(link.metric_id)}
                      left={<Icon name="checkmark-circle" size={16} color={theme.colors.success} />}
                    />
                  ) : link ? (
                    <Button
                      title="Review reading"
                      fullWidth={false}
                      onPress={() => openConfirm(link.metric_id)}
                      left={<Icon name="reader" size={16} color={theme.colors.onPrimary} />}
                    />
                  ) : (
                    <Button
                      title="Read with AI"
                      variant="secondary"
                      fullWidth={false}
                      loading={ocrBusyId === item.id}
                      disabled={ocrBusyId != null}
                      onPress={() => readWithAi(item.id)}
                      left={<Icon name="sparkles" size={16} color={theme.colors.text} />}
                    />
                  )
                ) : link?.verified ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Icon name="checkmark-circle" size={18} color={theme.colors.success} />
                    <Text variant="caption" color="success">
                      Reviewed by your coach
                    </Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Icon name="hourglass-outline" size={18} color={theme.colors.warning} />
                    <Text variant="caption" muted>
                      Submitted — awaiting coach review
                    </Text>
                  </View>
                )}
                {/* Coach comments are visible to both the athlete and the coach. */}
                <CommentList comments={scanComments} />
              </View>
            </GlassCard>
          );
        }}
      />
    </Screen>
  );
}

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
import { useTranslation } from 'react-i18next';
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

function CommentList({ comments }: { comments: MetricComment[] }) {
  const { t } = useTranslation();
  if (comments.length === 0) return null;
  return (
    <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
      {comments.map((c) => (
        <View key={c.id} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Icon name="chatbubble-ellipses" size={16} color={theme.colors.primary} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text variant="body">{c.body}</Text>
            <Text variant="label" muted style={{ fontSize: 10, marginTop: 2 }}>
              {t('progress.coachTag')} ·{' '}
              {new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function InBodyScans() {
  const { t } = useTranslation();
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
        setNotice(t('progress.alreadyToday'));
        await load();
      } else if ('denied' in res) setNotice(t('progress.permDenied'));
    } catch {
      setNotice(t('progress.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  // Coach-facing messages for the AI read outcomes that don't navigate onward.
  const ocrMessage = (status: OcrStatus): string => {
    switch (status) {
      case 'not_readable':
        return t('progress.ocr.notReadable');
      case 'unsupported_type':
        return t('progress.ocr.unsupportedType');
      case 'rate_limited':
        return t('progress.ocr.rateLimited');
      default:
        return t('progress.ocr.failed');
    }
  };

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
        setNotice(ocrMessage(res.status));
      }
    } catch {
      setNotice(t('progress.ocr.failed'));
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
            <Text variant="h2">{t('progress.inbodyScans')}</Text>
            {!isCoachView ? (
              <GlassCard style={{ gap: theme.spacing.sm }}>
                {submittedToday ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Icon name="checkmark-circle" size={18} color={theme.colors.success} />
                    <Text variant="caption" muted style={{ flex: 1 }}>
                      {t('progress.submittedToday')}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text variant="caption" muted>
                      {t('progress.submitInbody')}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                      <Button
                        title={t('progress.camera')}
                        variant="secondary"
                        style={{ flex: 1 }}
                        disabled={uploading}
                        onPress={() => add('camera')}
                        left={<Icon name="camera" size={18} color={theme.colors.text} />}
                      />
                      <Button
                        title={t('progress.library')}
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
                          {t('progress.uploading')}
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
              title={t('progress.noScansTitle')}
              subtitle={isCoachView ? t('progress.noScansCoach') : t('progress.noScansOwn')}
            />
          )
        }
        renderItem={({ item }) => {
          const link = links[item.id];
          const scanComments = comments[item.id] ?? [];
          return (
            <GlassCard padded={false} style={{ overflow: 'hidden' }}>
              <Pressable onPress={() => router.push({ pathname: '/client/progress/view', params: { mediaId: item.id, own: isCoachView ? '0' : '1' } })}>
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
                      title={t('progress.reviewedOpen')}
                      variant="secondary"
                      fullWidth={false}
                      onPress={() => openConfirm(link.metric_id)}
                      left={<Icon name="checkmark-circle" size={16} color={theme.colors.success} />}
                    />
                  ) : link ? (
                    <Button
                      title={t('progress.reviewReading')}
                      fullWidth={false}
                      onPress={() => openConfirm(link.metric_id)}
                      left={<Icon name="reader" size={16} color={theme.colors.onPrimary} />}
                    />
                  ) : (
                    <Button
                      title={t('progress.readWithAi')}
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
                      {t('progress.reviewedByCoach')}
                    </Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Icon name="hourglass-outline" size={18} color={theme.colors.warning} />
                    <Text variant="caption" muted>
                      {t('progress.awaitingReview')}
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

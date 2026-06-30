// Client → before/after builder (athlete side of E3, 0083). The client picks a BEFORE and
// an AFTER photo — from their existing progress photos or a new upload — adds a caption, and
// SENDS it to their coach. It arrives as a PENDING submission the coach reviews; on approval
// it's featured on the coach's public showcase. Sending sets transformation-sharing consent
// (revocable anytime in Public presence). Reuses the secure media pipeline + RLS throughout.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { useMyCoach } from '../../src/lib/queries/home';
import { textStart } from '../../src/lib/rtl';
import { queryClient } from '../../src/lib/query';
import { confirmDestructive } from '../../src/lib/confirm';
import { captureAndUploadPhoto } from '../../src/lib/upload';
import { listMediaFor, type Media } from '../../src/lib/media';
import {
  listMySubmissions,
  createSubmission,
  deleteSubmission,
  setTransformationConsent,
  copyProgressPhotoToTransformation,
  type SubmissionStatus,
} from '../../src/lib/transformation-submissions';
import { Icon, Screen, Text, GlassCard, Button, Input, SignedImage, EmptyState, Badge, useToast } from '../../src/components/ui';
import { theme } from '../../src/theme';

type Slot = 'before' | 'after';

const STATUS_TONE: Record<SubmissionStatus, 'warning' | 'success' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  dismissed: 'neutral',
};

export default function ClientTransformationBuilder() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const userId = session?.user?.id;
  const toast = useToast();

  const coachQ = useMyCoach(userId);
  const coach = coachQ.data ?? null;

  const submissionsQ = useQuery({
    queryKey: ['my-transformation-submissions', userId],
    queryFn: () => listMySubmissions(userId!),
    enabled: !!userId,
  });

  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [picker, setPicker] = useState<Slot | null>(null);
  const [working, setWorking] = useState(false); // upload/copy in flight
  const [sending, setSending] = useState(false);

  const setSlot = (slot: Slot, id: string | null) => (slot === 'before' ? setBeforeId : setAfterId)(id);

  const reset = useCallback(() => {
    setBeforeId(null);
    setAfterId(null);
    setCaption('');
  }, []);

  if (role && role !== 'client') return <Redirect href="/" />;

  async function uploadNew(slot: Slot) {
    setWorking(true);
    try {
      // squareCrop opens the pan + pinch-zoom editor (1:1) so the client can frame the shot.
      const res = await captureAndUploadPhoto({ source: 'library', kind: 'transformation', squareCrop: true });
      if ('mediaId' in res) {
        setSlot(slot, res.mediaId);
        setPicker(null);
      } else if ('limited' in res) {
        toast.show(t('publicProfile.photoError'), 'error');
      }
    } catch {
      toast.show(t('publicProfile.photoError'), 'error');
    } finally {
      setWorking(false);
    }
  }

  async function chooseExisting(slot: Slot, progressMediaId: string) {
    setWorking(true);
    try {
      const newId = await copyProgressPhotoToTransformation(progressMediaId);
      if (newId) {
        setSlot(slot, newId);
        setPicker(null);
      } else {
        toast.show(t('publicProfile.photoError'), 'error');
      }
    } catch {
      toast.show(t('publicProfile.photoError'), 'error');
    } finally {
      setWorking(false);
    }
  }

  async function onSend() {
    if (!userId || !coach || !beforeId || !afterId) return;
    setSending(true);
    try {
      await createSubmission({
        clientId: userId,
        coachId: coach.id,
        caption: caption.trim() || null,
        beforeMediaId: beforeId,
        afterMediaId: afterId,
      });
      // Sending is explicit consent to be featured (revocable in Public presence).
      await setTransformationConsent(userId, true).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: ['my-transformation-submissions', userId] });
      toast.show(t('clientTransformation.sent'));
      reset();
    } catch {
      toast.show(t('common.saveFailed'), 'error');
    } finally {
      setSending(false);
    }
  }

  async function onWithdraw(id: string) {
    const ok = await confirmDestructive(t('clientTransformation.withdrawTitle'), t('clientTransformation.withdrawBody'), t('clientTransformation.withdraw'));
    if (!ok) return;
    try {
      await deleteSubmission(id);
      await queryClient.invalidateQueries({ queryKey: ['my-transformation-submissions', userId] });
    } catch {
      toast.show(t('common.error'), 'error');
    }
  }

  const submissions = submissionsQ.data ?? [];
  const canSend = !!coach && !!beforeId && !!afterId && !sending && !working;

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <Stack.Screen options={{ title: t('clientTransformation.title') }} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text variant="body" muted style={textStart}>
          {t('clientTransformation.help')}
        </Text>

        {!coach ? (
          <EmptyState icon="people-outline" title={t('clientTransformation.noCoachTitle')} subtitle={t('clientTransformation.noCoachSub')} />
        ) : (
          <>
            {/* Builder */}
            <GlassCard style={{ gap: theme.spacing.md }}>
              <Text variant="label" muted style={textStart}>
                {t('clientTransformation.createTitle')}
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                {(['before', 'after'] as const).map((slot) => {
                  const id = slot === 'before' ? beforeId : afterId;
                  return (
                    <Pressable key={slot} onPress={() => !working && setPicker(slot)} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                      {id ? (
                        <SignedImage mediaId={id} style={{ width: '100%', height: 130, borderRadius: theme.radii.md }} />
                      ) : (
                        <View
                          style={{
                            width: '100%',
                            height: 130,
                            borderRadius: theme.radii.md,
                            backgroundColor: theme.colors.glass,
                            borderWidth: 1,
                            borderColor: theme.colors.glassBorder,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Icon name="camera" size={22} color={theme.colors.textMuted} />
                        </View>
                      )}
                      <Text variant="label" muted>
                        {slot === 'before' ? t('coachProfile.before') : t('coachProfile.after')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Input value={caption} onChangeText={setCaption} placeholder={t('coachProfile.captionPlaceholder')} maxLength={200} />

              <Text variant="caption" muted style={textStart}>
                {t('clientTransformation.consentNote')}
              </Text>
              <Button
                title={sending ? t('clientTransformation.sending') : t('clientTransformation.send')}
                onPress={onSend}
                loading={sending}
                disabled={!canSend}
              />
            </GlassCard>

            {/* My submissions */}
            {submissions.length > 0 ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" muted style={textStart}>
                  {t('clientTransformation.mySubmissions')}
                </Text>
                {submissions.map((s) => (
                  <GlassCard key={s.id} style={{ gap: theme.spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                      <Badge label={t(`clientTransformation.status.${s.status}`)} tone={STATUS_TONE[s.status]} />
                      <View style={{ flex: 1 }} />
                      {s.status !== 'approved' ? (
                        <Pressable onPress={() => onWithdraw(s.id)} hitSlop={8}>
                          <Icon name="trash" size={18} color={theme.colors.danger} />
                        </Pressable>
                      ) : null}
                    </View>
                    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                      {s.before_media_id ? (
                        <SignedImage mediaId={s.before_media_id} style={{ width: 64, height: 64, borderRadius: theme.radii.sm }} />
                      ) : null}
                      {s.after_media_id ? (
                        <SignedImage mediaId={s.after_media_id} style={{ width: 64, height: 64, borderRadius: theme.radii.sm }} />
                      ) : null}
                    </View>
                    {s.caption ? (
                      <Text variant="caption" muted style={textStart}>
                        {s.caption}
                      </Text>
                    ) : null}
                  </GlassCard>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Photo-source picker: upload new OR pick from existing progress photos. */}
      <SourcePicker
        slot={picker}
        ownerId={userId}
        working={working}
        onUploadNew={uploadNew}
        onChooseExisting={chooseExisting}
        onClose={() => !working && setPicker(null)}
      />
    </Screen>
  );
}

/** Bottom-sheet modal: "Upload new" or a grid of the client's existing progress photos. */
function SourcePicker({
  slot,
  ownerId,
  working,
  onUploadNew,
  onChooseExisting,
  onClose,
}: {
  slot: Slot | null;
  ownerId?: string;
  working: boolean;
  onUploadNew: (slot: Slot) => void;
  onChooseExisting: (slot: Slot, mediaId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<Media[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slot || !ownerId) return;
    setLoading(true);
    listMediaFor(ownerId, 'progress_photo')
      .then(setPhotos)
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false));
  }, [slot, ownerId]);

  return (
    <Modal visible={slot != null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay }} onPress={onClose}>
        <Pressable
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            padding: theme.spacing.lg,
            paddingBottom: theme.spacing.xl,
            gap: theme.spacing.md,
            maxHeight: '70%',
          }}
          onPress={() => {}}
        >
          <Text variant="title" style={textStart}>
            {t('clientTransformation.choosePhoto')}
          </Text>

          <Button
            title={t('clientTransformation.uploadNew')}
            onPress={() => slot && onUploadNew(slot)}
            variant="secondary"
            disabled={working}
          />

          <Text variant="label" muted style={textStart}>
            {t('clientTransformation.fromProgressPhotos')}
          </Text>
          {loading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : photos.length === 0 ? (
            <Text variant="caption" muted style={textStart}>
              {t('clientTransformation.noProgressPhotos')}
            </Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {photos.map((p) => (
                  <Pressable key={p.id} onPress={() => slot && !working && onChooseExisting(slot, p.id)} disabled={working}>
                    <SignedImage mediaId={p.id} style={{ width: 96, height: 96, borderRadius: theme.radii.sm }} />
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}

          {working ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text variant="caption" muted>
                {t('clientTransformation.preparing')}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

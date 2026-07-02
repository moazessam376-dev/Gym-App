// Client → before/after builder (athlete side of E3). The client uses the shared
// TransformationEditor (frame photos, layout, manual stats/dates, live branded preview) to
// build a card and SEND it to their coach as a PENDING submission; on approval it's featured.
// Photos come from a new upload OR an existing progress photo (the SourcePicker). Sending sets
// transformation-sharing consent. Once a card is featured, the client sees + SHARES it here too.
import { useEffect, useRef, useState } from 'react';
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
import { getAthleteTransformations, type TransformationCardInput } from '../../src/lib/public-profiles';
import {
  listMySubmissions,
  createSubmission,
  deleteSubmission,
  setTransformationConsent,
  copyProgressPhotoToTransformation,
  type SubmissionStatus,
} from '../../src/lib/transformation-submissions';
import { Icon, Screen, Text, GlassCard, Button, SignedImage, EmptyState, Badge, useToast } from '../../src/components/ui';
import { ShareableTransformationCard } from '../../src/components/ShareableTransformationCard';
import { TransformationEditor } from '../../src/components/transformations/TransformationEditor';
import { theme } from '../../src/theme';

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
  const submissionsQ = useQuery({ queryKey: ['my-transformation-submissions', userId], queryFn: () => listMySubmissions(userId!), enabled: !!userId });
  const myCardQ = useQuery({ queryKey: ['athlete-transformations', userId], queryFn: () => getAthleteTransformations(userId!), enabled: !!userId });

  const [editorKey, setEditorKey] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [sentView, setSentView] = useState(false);
  const resolverRef = useRef<((id: string | null) => void) | null>(null);

  if (role && role !== 'client') return <Redirect href="/" />;

  // Promise-based photo pick: the editor awaits this; the SourcePicker resolves it.
  const pickPhoto = () =>
    new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
      setPickerOpen(true);
    });
  const resolvePick = (id: string | null) => {
    resolverRef.current?.(id);
    resolverRef.current = null;
    setPickerOpen(false);
  };

  const uploadNew = async () => {
    setWorking(true);
    try {
      const res = await captureAndUploadPhoto({ source: 'library', kind: 'transformation' });
      if ('mediaId' in res) resolvePick(res.mediaId);
      else {
        if ('limited' in res) toast.show(t('transformationEditor.photoLimit'), 'error');
        resolvePick(null);
      }
    } catch {
      toast.show(t('transformationEditor.photoError'), 'error');
      resolvePick(null);
    } finally {
      setWorking(false);
    }
  };

  const chooseExisting = async (progressMediaId: string) => {
    setWorking(true);
    try {
      const newId = await copyProgressPhotoToTransformation(progressMediaId);
      resolvePick(newId);
      if (!newId) toast.show(t('transformationEditor.photoError'), 'error');
    } catch {
      toast.show(t('transformationEditor.photoError'), 'error');
      resolvePick(null);
    } finally {
      setWorking(false);
    }
  };

  const onSave = async (input: TransformationCardInput) => {
    if (!userId || !coach) return;
    await createSubmission({ clientId: userId, coachId: coach.id, ...input });
    await setTransformationConsent(userId, true).catch(() => {});
    await queryClient.invalidateQueries({ queryKey: ['my-transformation-submissions', userId] });
    setEditorKey((k) => k + 1); // reset the editor for the next submission
    setSentView(true); // the "sent for review" confirmation replaces the silent reset
  };

  const onWithdraw = (id: string) => async () => {
    const ok = await confirmDestructive(t('clientTransformation.withdrawTitle'), t('clientTransformation.withdrawBody'), t('clientTransformation.withdraw'));
    if (!ok) return;
    try {
      await deleteSubmission(id);
      await queryClient.invalidateQueries({ queryKey: ['my-transformation-submissions', userId] });
    } catch {
      toast.show(t('common.error'), 'error');
    }
  };

  const submissions = submissionsQ.data ?? [];
  const myCards = myCardQ.data ?? [];
  const firstName = (session?.user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] ?? null;

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <Stack.Screen options={{ title: t('clientTransformation.title') }} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text variant="body" muted style={textStart}>{t('clientTransformation.help')}</Text>

        {!coach ? (
          <EmptyState icon="people-outline" title={t('clientTransformation.noCoachTitle')} subtitle={t('clientTransformation.noCoachSub')} />
        ) : (
          <>
            {/* My featured card(s): view + share. */}
            {myCards.length > 0 ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" muted style={textStart}>{t('clientTransformation.myCard')}</Text>
                {myCards.map((card) => (
                  <View key={card.transformation_id} style={{ alignItems: 'center' }}>
                    <ShareableTransformationCard item={card} coachName={coach.full_name ?? undefined} />
                  </View>
                ))}
              </View>
            ) : null}

            {/* Builder — or the "sent for review" confirmation right after a submit */}
            {sentView ? (
              <GlassCard style={{ alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.xl }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(63,217,192,0.14)', borderWidth: 1, borderColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check-circle" size={26} color={theme.colors.primary} />
                </View>
                <Text variant="title">{t('clientTransformation.sentTitle')}</Text>
                <Text variant="caption" muted style={{ textAlign: 'center', maxWidth: 280 }}>{t('clientTransformation.sentBody')}</Text>
                <Button title={t('clientTransformation.sendAnother')} variant="secondary" onPress={() => setSentView(false)} />
              </GlassCard>
            ) : (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" muted style={textStart}>{t('clientTransformation.createTitle')}</Text>
                <TransformationEditor
                  key={editorKey}
                  mode="client"
                  clientFirstName={firstName}
                  coachName={coach.full_name ?? undefined}
                  pickPhoto={pickPhoto}
                  onSave={onSave}
                  saveLabel={t('clientTransformation.send')}
                />
              </View>
            )}

            {/* My submissions */}
            {submissions.length > 0 ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="label" muted style={textStart}>{t('clientTransformation.mySubmissions')}</Text>
                {submissions.map((s) => (
                  <GlassCard key={s.id} style={{ gap: theme.spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                      <Badge label={t(`clientTransformation.status.${s.status}`)} tone={STATUS_TONE[s.status]} />
                      <View style={{ flex: 1 }} />
                      {s.status !== 'approved' ? (
                        <Pressable onPress={onWithdraw(s.id)} hitSlop={8}><Icon name="trash" size={18} color={theme.colors.danger} /></Pressable>
                      ) : null}
                    </View>
                    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                      {s.before_media_id ? <SignedImage mediaId={s.before_media_id} style={{ width: 64, height: 64, borderRadius: theme.radii.sm }} /> : null}
                      {s.after_media_id ? <SignedImage mediaId={s.after_media_id} style={{ width: 64, height: 64, borderRadius: theme.radii.sm }} /> : null}
                    </View>
                    {s.caption ? <Text variant="caption" muted style={textStart}>{s.caption}</Text> : null}
                  </GlassCard>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Photo source: upload new OR reuse an existing progress photo. */}
      <SourcePicker visible={pickerOpen} ownerId={userId} working={working} onUploadNew={uploadNew} onChooseExisting={chooseExisting} onClose={() => resolvePick(null)} />
    </Screen>
  );
}

/** Bottom-sheet modal: "Upload new" or a grid of the client's existing progress photos. */
function SourcePicker({
  visible,
  ownerId,
  working,
  onUploadNew,
  onChooseExisting,
  onClose,
}: {
  visible: boolean;
  ownerId?: string;
  working: boolean;
  onUploadNew: () => void;
  onChooseExisting: (mediaId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<Media[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !ownerId) return;
    setLoading(true);
    listMediaFor(ownerId, 'progress_photo')
      .then(setPhotos)
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false));
  }, [visible, ownerId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay }} onPress={() => !working && onClose()}>
        <Pressable style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: theme.spacing.lg, paddingBottom: theme.spacing.xl, gap: theme.spacing.md, maxHeight: '70%' }} onPress={() => {}}>
          <Text variant="title" style={textStart}>{t('clientTransformation.choosePhoto')}</Text>
          <Button title={t('clientTransformation.uploadNew')} onPress={onUploadNew} variant="secondary" disabled={working} />
          <Text variant="label" muted style={textStart}>{t('clientTransformation.fromProgressPhotos')}</Text>
          {loading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : photos.length === 0 ? (
            <Text variant="caption" muted style={textStart}>{t('clientTransformation.noProgressPhotos')}</Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {photos.map((p) => (
                  <Pressable key={p.id} onPress={() => !working && onChooseExisting(p.id)} disabled={working}>
                    <SignedImage mediaId={p.id} style={{ width: 96, height: 96, borderRadius: theme.radii.sm }} />
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
          {working ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text variant="caption" muted>{t('clientTransformation.preparing')}</Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

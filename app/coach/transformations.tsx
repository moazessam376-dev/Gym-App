// Coach transformations editor (Engagement E3). The coach curates before/after showcase cards
// for clients who CONSENTED (athlete_profile.allow_transformation_sharing). Pick a client →
// the full TransformationEditor (frame photos, layout, manual stats/dates, live branded-card
// preview) → save. Existing cards render as the real branded card with Edit/Delete. Client
// submissions await review here (approve features them, dismiss clears them).
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { textStart } from '../../src/lib/rtl';
import { queryClient } from '../../src/lib/query';
import { confirmDestructive } from '../../src/lib/confirm';
import {
  listMyTransformations,
  listConsentingClients,
  upsertTransformation,
  deleteTransformation,
  type ConsentingClient,
  type MyTransformation,
} from '../../src/lib/coach-transformations';
import { getCoachTransformations, type TransformationCardInput } from '../../src/lib/public-profiles';
import { listPendingSubmissions, resolveSubmission } from '../../src/lib/transformation-submissions';
import { ProfileAvatar } from '../../src/components/ProfileAvatar';
import { Icon, Screen, Text, GlassCard, Button, SignedImage, EmptyState, Badge, useToast } from '../../src/components/ui';
import { ShareableTransformationCard } from '../../src/components/ShareableTransformationCard';
import { TransformationEditor } from '../../src/components/transformations/TransformationEditor';
import { theme } from '../../src/theme';

type EditorTarget = {
  clientId: string;
  clientFirstName: string | null;
  initial?: Partial<TransformationCardInput> & { bodyFatLostPct?: number | null; leanMassGainedKg?: number | null };
};

/** A stored raw card row → the editor's initial values. */
function rawToInitial(row: MyTransformation): EditorTarget['initial'] {
  return {
    caption: row.caption,
    beforeMediaId: row.before_media_id,
    afterMediaId: row.after_media_id,
    bodyFatLostPct: row.body_fat_delta_bp_override != null ? row.body_fat_delta_bp_override / 100 : null,
    leanMassGainedKg: row.lean_mass_delta_grams_override != null ? row.lean_mass_delta_grams_override / 1000 : null,
    tierBeforeOverride: row.tier_before_override,
    tierAfterOverride: row.tier_after_override,
    measurementStartedAt: row.measurement_started_at,
    measurementEndedAt: row.measurement_ended_at,
    layout: row.layout,
    beforeFrame: row.before_frame,
    afterFrame: row.after_frame,
  };
}

export default function CoachTransformationsEditor() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const userId = session?.user?.id;
  const toast = useToast();

  const rawQ = useQuery({ queryKey: ['my-transformations', userId], queryFn: () => listMyTransformations(userId!), enabled: !!userId });
  const cardsQ = useQuery({ queryKey: ['coach-transformations', userId], queryFn: () => getCoachTransformations(userId!), enabled: !!userId });
  const clientsQ = useQuery({ queryKey: ['consenting-clients', userId], queryFn: () => listConsentingClients(userId!), enabled: !!userId });
  const pendingQ = useQuery({ queryKey: ['pending-transformation-submissions', userId], queryFn: () => listPendingSubmissions(userId!), enabled: !!userId });

  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-transformations', userId] }),
      queryClient.invalidateQueries({ queryKey: ['coach-transformations', userId] }),
    ]);
  }, [userId]);

  if (role && role !== 'coach') return <Redirect href="/" />;

  const onSave = async (input: TransformationCardInput) => {
    if (!userId || !editor) return;
    await upsertTransformation({ coachId: userId, clientId: editor.clientId, ...input });
    await invalidate();
    toast.show(t('common.saved'));
    setEditor(null);
  };

  const onDelete = (id: string) => async () => {
    const ok = await confirmDestructive(t('coachProfile.deleteTitle'), t('coachProfile.deleteMessage'), t('common.delete'));
    if (!ok) return;
    try {
      await deleteTransformation(id);
      await invalidate();
      toast.show(t('common.saved'));
    } catch {
      toast.show(t('common.error'), 'error');
    }
  };

  const onResolve = (id: string, action: 'approve' | 'dismiss') => async () => {
    setResolving(id);
    try {
      await resolveSubmission(id, action);
      await queryClient.invalidateQueries({ queryKey: ['pending-transformation-submissions', userId] });
      if (action === 'approve') await invalidate();
      toast.show(action === 'approve' ? t('coachProfile.submissionApproved') : t('coachProfile.submissionDismissed'));
    } catch {
      toast.show(t('common.error'), 'error');
    } finally {
      setResolving(null);
    }
  };

  const clients = clientsQ.data ?? [];
  const raw = rawQ.data ?? [];
  const cards = cardsQ.data ?? [];
  const pending = pendingQ.data ?? [];
  const coachName = session?.user?.user_metadata?.full_name as string | undefined;

  // ── Editing / creating a card ──────────────────────────────────────────────────
  if (editor) {
    return (
      <Screen gradient padded={false} edges={['bottom']}>
        <Stack.Screen options={{ title: t('coachProfile.manageTransformations') }} />
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Pressable onPress={() => setEditor(null)} hitSlop={8}><Icon name="chevron-back" size={22} color={theme.colors.text} /></Pressable>
            <Text variant="bodyStrong" style={[{ flex: 1 }, textStart]}>{editor.clientFirstName ?? ''}</Text>
          </View>
          <TransformationEditor
            mode="coach"
            clientFirstName={editor.clientFirstName}
            coachName={coachName}
            initial={editor.initial}
            onSave={onSave}
            saveLabel={t('common.save')}
          />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <Stack.Screen options={{ title: t('coachProfile.manageTransformations') }} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text variant="body" muted style={textStart}>{t('coachProfile.transformationsHelp')}</Text>

        {/* Pending client submissions: approve features it, dismiss clears it. */}
        {pending.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" muted style={textStart}>{t('coachProfile.pendingSubmissions')}</Text>
            {pending.map((sub) => (
              <GlassCard key={sub.id} style={{ gap: theme.spacing.sm, borderColor: theme.colors.primary }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <ProfileAvatar name={sub.client_name} avatarMediaId={sub.client_avatar_media_id} size={28} />
                  <Text variant="bodyStrong" style={[{ flex: 1 }, textStart]}>{sub.client_name ?? ''}</Text>
                  <Badge label={t('clientTransformation.status.pending')} tone="warning" />
                </View>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  {sub.before_media_id ? <SignedImage mediaId={sub.before_media_id} style={{ width: 80, height: 80, borderRadius: theme.radii.sm }} /> : null}
                  {sub.after_media_id ? <SignedImage mediaId={sub.after_media_id} style={{ width: 80, height: 80, borderRadius: theme.radii.sm }} /> : null}
                </View>
                {sub.caption ? <Text variant="caption" muted style={textStart}>{sub.caption}</Text> : null}
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <Button title={t('coachProfile.approveFeature')} onPress={onResolve(sub.id, 'approve')} loading={resolving === sub.id} disabled={resolving != null} style={{ flex: 1 }} />
                  <Button title={t('coachProfile.dismiss')} variant="secondary" onPress={onResolve(sub.id, 'dismiss')} disabled={resolving != null} style={{ flex: 1 }} />
                </View>
              </GlassCard>
            ))}
          </View>
        ) : null}

        {/* Existing cards — the real branded card + Edit / Delete. */}
        {cards.map((card) => {
          const rawRow = raw.find((r) => r.id === card.transformation_id);
          return (
            <View key={card.transformation_id} style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
              <ShareableTransformationCard item={card} coachName={coachName} />
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignSelf: 'stretch' }}>
                <Button
                  title={t('common.edit')}
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => rawRow && setEditor({ clientId: rawRow.client_id, clientFirstName: card.client_first_name, initial: rawToInitial(rawRow) })}
                />
                <Button title={t('common.delete')} variant="ghost" style={{ flex: 1 }} onPress={onDelete(card.transformation_id)} />
              </View>
            </View>
          );
        })}

        {/* Add new — pick a consenting client to open the editor. */}
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>{t('coachProfile.addTransformation')}</Text>
          {clientsQ.isLoading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : clients.length === 0 ? (
            <EmptyState icon="people-outline" title={t('coachProfile.noConsentingClients')} subtitle={t('coachProfile.noConsentingClientsSub')} />
          ) : (
            <GlassCard style={{ gap: theme.spacing.md }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {clients.map((c: ConsentingClient) => (
                  <Pressable
                    key={c.user_id}
                    onPress={() => setEditor({ clientId: c.user_id, clientFirstName: c.full_name?.split(' ')[0] ?? null })}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: theme.spacing.sm, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.glassBorder, backgroundColor: theme.colors.glass }}
                  >
                    <ProfileAvatar name={c.full_name} avatarMediaId={c.avatar_media_id} size={24} />
                    <Text variant="caption">{c.full_name ?? ''}</Text>
                  </Pressable>
                ))}
              </View>
            </GlassCard>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

// Coach transformations editor (Engagement E3). The coach curates before/after showcase
// cards for clients who have CONSENTED (athlete_profile.allow_transformation_sharing). Pick a
// consenting client, upload a before + after photo (uploaded as the consent-tied `transformation`
// media kind), add a caption, save. The public showcase renders these on the coach profile.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { textStart } from '../../src/lib/rtl';
import { queryClient } from '../../src/lib/query';
import { confirmDestructive } from '../../src/lib/confirm';
import { captureAndUploadPhoto } from '../../src/lib/upload';
import {
  listMyTransformations,
  listConsentingClients,
  upsertTransformation,
  deleteTransformation,
  type ConsentingClient,
} from '../../src/lib/coach-transformations';
import { ProfileAvatar } from '../../src/components/ProfileAvatar';
import { Icon, Screen, Text, GlassCard, Button, Input, SignedImage, EmptyState, useToast } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function CoachTransformationsEditor() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const userId = session?.user?.id;
  const toast = useToast();

  const existingQ = useQuery({
    queryKey: ['my-transformations', userId],
    queryFn: () => listMyTransformations(userId!),
    enabled: !!userId,
  });
  const clientsQ = useQuery({
    queryKey: ['consenting-clients', userId],
    queryFn: () => listConsentingClients(userId!),
    enabled: !!userId,
  });

  const [selected, setSelected] = useState<ConsentingClient | null>(null);
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState<'before' | 'after' | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setSelected(null);
    setBeforeId(null);
    setAfterId(null);
    setCaption('');
  }, []);

  if (role && role !== 'coach') return <Redirect href="/" />;

  async function pickPhoto(which: 'before' | 'after') {
    setUploading(which);
    try {
      const res = await captureAndUploadPhoto({ source: 'library', kind: 'transformation' });
      if ('mediaId' in res) (which === 'before' ? setBeforeId : setAfterId)(res.mediaId);
      else if ('limited' in res) toast.show(t('publicProfile.photoError'), 'error');
    } catch {
      toast.show(t('publicProfile.photoError'), 'error');
    } finally {
      setUploading(null);
    }
  }

  async function onSave() {
    if (!userId || !selected) return;
    setSaving(true);
    try {
      await upsertTransformation({
        coachId: userId,
        clientId: selected.user_id,
        caption: caption.trim() || null,
        beforeMediaId: beforeId,
        afterMediaId: afterId,
      });
      await queryClient.invalidateQueries({ queryKey: ['my-transformations', userId] });
      await queryClient.invalidateQueries({ queryKey: ['coach-transformations', userId] });
      toast.show(t('common.saved'));
      reset();
    } catch {
      toast.show(t('common.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    const ok = await confirmDestructive(t('coachProfile.deleteTitle'), t('coachProfile.deleteMessage'), t('common.delete'));
    if (!ok) return;
    try {
      await deleteTransformation(id);
      await queryClient.invalidateQueries({ queryKey: ['my-transformations', userId] });
      await queryClient.invalidateQueries({ queryKey: ['coach-transformations', userId] });
      toast.show(t('common.saved'));
    } catch {
      toast.show(t('common.error'), 'error');
    }
  }

  const clients = clientsQ.data ?? [];
  const existing = existingQ.data ?? [];

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <Stack.Screen options={{ title: t('coachProfile.manageTransformations') }} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text variant="body" muted style={textStart}>
          {t('coachProfile.transformationsHelp')}
        </Text>

        {/* Existing */}
        {existing.map((tr) => (
          <GlassCard key={tr.id} style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <Text variant="bodyStrong" style={[{ flex: 1 }, textStart]}>
                {tr.client_name ?? ''}
              </Text>
              <Pressable onPress={() => onDelete(tr.id)} hitSlop={8}>
                <Icon name="trash" size={18} color={theme.colors.danger} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              {tr.before_media_id ? (
                <SignedImage mediaId={tr.before_media_id} style={{ width: 64, height: 64, borderRadius: theme.radii.sm }} />
              ) : null}
              {tr.after_media_id ? (
                <SignedImage mediaId={tr.after_media_id} style={{ width: 64, height: 64, borderRadius: theme.radii.sm }} />
              ) : null}
            </View>
            {tr.caption ? (
              <Text variant="caption" muted style={textStart}>
                {tr.caption}
              </Text>
            ) : null}
          </GlassCard>
        ))}

        {/* Add new */}
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('coachProfile.addTransformation')}
          </Text>
          {clientsQ.isLoading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : clients.length === 0 ? (
            <EmptyState icon="people-outline" title={t('coachProfile.noConsentingClients')} subtitle={t('coachProfile.noConsentingClientsSub')} />
          ) : (
            <GlassCard style={{ gap: theme.spacing.md }}>
              {/* Client picker */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {clients.map((c) => {
                  const on = selected?.user_id === c.user_id;
                  return (
                    <Pressable
                      key={c.user_id}
                      onPress={() => setSelected(c)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingVertical: 6,
                        paddingHorizontal: theme.spacing.sm,
                        borderRadius: theme.radii.md,
                        borderWidth: 1,
                        borderColor: on ? theme.colors.primary : theme.colors.glassBorder,
                        backgroundColor: on ? 'rgba(0,224,255,0.10)' : theme.colors.glass,
                      }}
                    >
                      <ProfileAvatar name={c.full_name} avatarMediaId={c.avatar_media_id} size={24} />
                      <Text variant="caption">{c.full_name ?? ''}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Before / after upload */}
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                {(['before', 'after'] as const).map((which) => {
                  const id = which === 'before' ? beforeId : afterId;
                  return (
                    <Pressable
                      key={which}
                      onPress={() => pickPhoto(which)}
                      style={{ flex: 1, alignItems: 'center', gap: 4 }}
                    >
                      {id ? (
                        <SignedImage mediaId={id} style={{ width: '100%', height: 120, borderRadius: theme.radii.md }} />
                      ) : (
                        <View
                          style={{
                            width: '100%',
                            height: 120,
                            borderRadius: theme.radii.md,
                            backgroundColor: theme.colors.glass,
                            borderWidth: 1,
                            borderColor: theme.colors.glassBorder,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {uploading === which ? (
                            <ActivityIndicator color={theme.colors.primary} />
                          ) : (
                            <Icon name="camera" size={22} color={theme.colors.textMuted} />
                          )}
                        </View>
                      )}
                      <Text variant="label" muted>
                        {which === 'before' ? t('coachProfile.before') : t('coachProfile.after')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Input value={caption} onChangeText={setCaption} placeholder={t('coachProfile.captionPlaceholder')} maxLength={200} />
              <Button title={t('common.save')} onPress={onSave} loading={saving} disabled={!selected} />
            </GlassCard>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

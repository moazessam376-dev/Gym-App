// InBody scan capture + history (secure media pipeline, migration 0013, kind=inbody).
// Users photograph the printed InBody sheet; it's uploaded via the same EXIF-strip +
// signed-URL pipeline as progress photos. This phase only CAPTURES + DISPLAYS — OCR
// extraction + verified ranking land in Phase 12 / L3. Read-only for a coach (?clientId=).
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { listMediaFor, type Media } from '../../../src/lib/media';
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

export default function InBodyScans() {
  const { role, session } = useAuth();
  const router = useRouter();
  const selfId = session?.user?.id;
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const ownerId = clientId ?? selfId;
  const readOnly = !!clientId && clientId !== selfId;

  const [scans, setScans] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      setScans(await listMediaFor(ownerId, 'inbody'));
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
                  Snap a photo of your InBody result sheet. Your coach can review it; automated
                  reading comes later.
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
                {notice ? (
                  <Text variant="caption" color="danger">
                    {notice}
                  </Text>
                ) : null}
              </GlassCard>
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
        renderItem={({ item }) => (
          <Pressable onPress={() => openScan(item.id)}>
            <GlassCard padded={false} style={{ overflow: 'hidden' }}>
              <SignedImage mediaId={item.id} style={{ width: '100%', height: 200 }} resizeMode="cover" />
              <View style={{ padding: theme.spacing.md, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Ionicons name="document-text" size={18} color={theme.colors.primary} />
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {longDate(item.created_at)}
                </Text>
                <Ionicons name="expand-outline" size={18} color={theme.colors.textMuted} />
              </View>
            </GlassCard>
          </Pressable>
        )}
      />
    </Screen>
  );
}

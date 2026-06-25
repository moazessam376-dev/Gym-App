// Progress-photo timeline (secure media pipeline, migration 0013). Owner captures/
// picks a photo → on-device downscale + JPEG re-encode (HEIC→JPEG, EXIF dropped) →
// uploaded via the Edge Functions (the app never writes the `media` row). Photos are
// grouped by day and served via short-lived signed URLs. Read-only for a coach (?clientId=).
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, Pressable, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { listMediaFor, type Media } from '../../../src/lib/media';
import { captureAndUploadPhoto, type PickSource } from '../../../src/lib/upload';
import { Icon, Screen, Text, Button, GlassCard, SignedImage, EmptyState } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

const COLS = 3;
const GAP = theme.spacing.sm;
const THUMB = Math.floor((Dimensions.get('window').width - theme.spacing.lg * 2 - GAP * (COLS - 1)) / COLS);

type DayGroup = { date: string; label: string; items: Media[] };

function groupByDay(media: Media[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const m of media) {
    const d = new Date(m.created_at);
    const key = d.toDateString();
    let g = byKey.get(key);
    if (!g) {
      g = {
        date: key,
        label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
        items: [],
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push(m);
  }
  return groups;
}

export default function ProgressPhotos() {
  const { role, session } = useAuth();
  const router = useRouter();
  const selfId = session?.user?.id;
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const ownerId = clientId ?? selfId;
  const readOnly = !!clientId && clientId !== selfId;

  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      setMedia(await listMediaFor(ownerId, 'progress_photo'));
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

  const groups = useMemo(() => groupByDay(media), [media]);

  if (role && role === 'admin') return <Redirect href="/" />;

  async function add(source: PickSource) {
    setNotice(null);
    setUploading(true);
    try {
      const res = await captureAndUploadPhoto({ source, kind: 'progress_photo' });
      if ('mediaId' in res) await load();
      else if ('denied' in res) setNotice('Permission denied. Enable photo/camera access in Settings.');
    } catch {
      setNotice('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  function openPhoto(id: string) {
    // own=1 enables the delete affordance in the viewer (owner, not a coach's read-only view).
    router.push({ pathname: '/client/progress/view', params: { mediaId: id, own: readOnly ? '0' : '1' } });
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <FlatList
        data={loading ? [] : groups}
        keyExtractor={(g) => g.date}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.lg }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
            <Text variant="h2">Progress photos</Text>
            {!readOnly ? (
              <GlassCard style={{ gap: theme.spacing.sm }}>
                <Text variant="caption" muted>
                  Photos are private — stored encrypted and only visible to you and your coach.
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
              icon="camera-outline"
              title="No photos yet"
              subtitle={readOnly ? 'This client hasn’t added progress photos yet.' : 'Add a photo to start your visual timeline.'}
            />
          )
        }
        renderItem={({ item: group }) => (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" muted>
              {group.label}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
              {group.items.map((m) => (
                <Pressable key={m.id} onPress={() => openPhoto(m.id)}>
                  <SignedImage
                    mediaId={m.id}
                    style={{ width: THUMB, height: THUMB, borderRadius: theme.radii.md }}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        )}
      />
    </Screen>
  );
}

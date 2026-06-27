// Full-screen viewer for a single private media object. The bytes come via a
// short-lived signed URL (SignedImage). Wrapped in a zoomable ScrollView so the
// user gets Photos-app-style pinch-to-zoom + pan (native on iOS).
//
// Delete: shown only when the caller OWNS the media (the `own` param, set by the
// grid when it isn't a coach's read-only view). The server (media-delete) enforces
// owner-only regardless, so the param just controls the affordance.
import { useState } from 'react';
import { Dimensions, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteMedia } from '../../../src/lib/media';
import { confirmDestructive } from '../../../src/lib/confirm';
import { haptics } from '../../../src/lib/haptics';
import { Icon, Text, SignedImage } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

export default function MediaView() {
  const { t } = useTranslation();
  const { mediaId, own } = useLocalSearchParams<{ mediaId?: string; own?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');
  const [zoomed, setZoomed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canDelete = own === '1';

  async function onDelete() {
    if (!mediaId || busy) return;
    const ok = await confirmDestructive(
      t('progress.deleteTitle'),
      t('progress.deleteBody'),
      t('common.delete'),
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await deleteMedia(mediaId);
      haptics.success();
      router.back();
    } catch {
      setError(t('progress.deleteError'));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['bottom']}>
      {mediaId ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }}
          maximumZoomScale={4}
          minimumZoomScale={1}
          bouncesZoom
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          pinchGestureEnabled
          onScroll={(e) => setZoomed(e.nativeEvent.zoomScale > 1)}
          scrollEventThrottle={32}
        >
          <SignedImage
            mediaId={mediaId}
            style={{ width, height }}
            resizeMode="contain"
          />
        </ScrollView>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="body" color={theme.colors.textMuted}>
            {t('progress.imageUnavailable')}
          </Text>
        </View>
      )}

      {/* Owner-only delete — top-right, clear of the status bar */}
      {mediaId && canDelete ? (
        <Pressable
          onPress={onDelete}
          disabled={busy}
          hitSlop={10}
          style={{
            position: 'absolute',
            top: insets.top + 8,
            right: 16,
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)',
            opacity: busy ? 0.5 : 1,
          }}
        >
          <Icon name="trash" size={22} color="#fff" />
        </Pressable>
      ) : null}

      {error ? (
        <Text
          variant="caption"
          color={theme.colors.danger}
          style={{ position: 'absolute', bottom: 56, alignSelf: 'center' }}
        >
          {error}
        </Text>
      ) : null}

      {/* Hint only before the first zoom, so it doesn't nag. */}
      {mediaId && !zoomed ? (
        <Text
          variant="caption"
          color={theme.colors.textMuted}
          style={{ position: 'absolute', bottom: 24, alignSelf: 'center' }}
        >
          {t('progress.pinchZoom')}
        </Text>
      ) : null}
    </SafeAreaView>
  );
}

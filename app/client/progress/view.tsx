// Full-screen viewer for a single private media object. The bytes come via a
// short-lived signed URL (SignedImage). Wrapped in a zoomable ScrollView so the
// user gets Photos-app-style pinch-to-zoom + pan (native on iOS).
import { useState } from 'react';
import { Dimensions, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, SignedImage } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

export default function MediaView() {
  const { mediaId } = useLocalSearchParams<{ mediaId?: string }>();
  const { width, height } = Dimensions.get('window');
  const [zoomed, setZoomed] = useState(false);

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
            Image unavailable.
          </Text>
        </View>
      )}
      {/* Hint only before the first zoom, so it doesn't nag. */}
      {mediaId && !zoomed ? (
        <Text
          variant="caption"
          color={theme.colors.textMuted}
          style={{ position: 'absolute', bottom: 24, alignSelf: 'center' }}
        >
          Pinch to zoom
        </Text>
      ) : null}
    </SafeAreaView>
  );
}

// Full-screen viewer for a single private media object. The bytes come via a
// short-lived signed URL (SignedImage) — the only way private media is served.
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, SignedImage } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

export default function MediaView() {
  const { mediaId } = useLocalSearchParams<{ mediaId?: string }>();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['bottom']}>
      {mediaId ? (
        <SignedImage mediaId={mediaId} style={{ flex: 1, width: '100%' }} resizeMode="contain" />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="body" color={theme.colors.textMuted}>
            Image unavailable.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

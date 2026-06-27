// Small, brand-tinted first-load spinner — no logo, no copy. Shown while a screen's
// primary query is pending on its FIRST open; because TanStack Query caches per key,
// a revisit already has data and skips this entirely (so the loader never repeats).
import { ActivityIndicator, View, type ViewStyle } from 'react-native';
import { theme } from '../../theme';

export function ScreenLoader({ style }: { style?: ViewStyle }) {
  return (
    <View
      style={[
        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
        style,
      ]}
    >
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}

// Branded boot splash — the "loading buffer" held over the app while the landing
// screen's data is prefetched, so the user enters a FULLY-POPULATED app instead of
// watching values fill in (YouTube-style logo hold). Rendered by RootNavigator
// while initializing or booting; it fades out once the cache is warm.
//
// Self-contained: fonts are already loaded before this mounts (RootLayout gates on
// them), so it can use the display font directly without the Text UI primitive.
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { theme } from '../theme';

export function BootSplash() {
  // Gentle breathing pulse on the logo tile so the hold feels alive, not frozen.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1.08, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);
  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Animated.View style={styles.fill} exiting={FadeOut.duration(280)}>
      <View style={styles.center}>
        <Animated.View style={logoStyle}>
          <LinearGradient
            colors={theme.gradients.hero}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logo}
          >
            <Ionicons name="barbell" size={40} color={theme.colors.primary} />
          </LinearGradient>
        </Animated.View>

        <Animated.Text style={styles.wordmark}>
          Gym<Animated.Text style={styles.wordmarkAccent}>App</Animated.Text>
        </Animated.Text>

        <ActivityIndicator color={theme.colors.primary} style={styles.spinner} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.bg,
    zIndex: 100,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.lg },
  logo: {
    width: 88,
    height: 88,
    borderRadius: theme.radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.glassBorder,
    // Soft glow around the logo tile.
    shadowColor: theme.colors.primaryGlow,
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  wordmark: {
    fontFamily: theme.fontFamily.displayBold,
    fontSize: 30,
    letterSpacing: -0.5,
    color: theme.colors.text,
  },
  wordmarkAccent: { color: theme.colors.primary },
  spinner: { marginTop: theme.spacing.sm },
});

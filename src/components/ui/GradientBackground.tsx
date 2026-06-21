import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '@/theme';

/** Absolute-fill deep-void gradient behind a screen's content. */
export function GradientBackground() {
  return (
    <LinearGradient
      colors={theme.gradients.screen}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

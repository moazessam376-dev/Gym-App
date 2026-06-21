import type { ReactNode } from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { theme } from '@/theme';
import { GradientBackground } from './GradientBackground';

export type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Render the deep-void gradient background (the Neon Glassy look). */
  gradient?: boolean;
  edges?: readonly Edge[];
  style?: ViewStyle;
  contentStyle?: ViewStyle;
};

/**
 * Standard dark screen wrapper: safe-area + app background, optional scroll and
 * default horizontal padding. Replaces the per-screen SafeAreaView + bg boilerplate.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  gradient = false,
  edges = ['top', 'left', 'right'],
  style,
  contentStyle,
}: ScreenProps) {
  const pad: ViewStyle = padded ? { paddingHorizontal: theme.spacing.lg } : {};

  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor: gradient ? 'transparent' : theme.colors.bg }, style]}
      edges={edges}
    >
      {gradient ? <GradientBackground /> : null}
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[pad, { paddingBottom: theme.spacing.xxl }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

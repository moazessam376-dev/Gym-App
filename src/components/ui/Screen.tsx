import type { ReactNode } from 'react';
import { ScrollView, View, type DimensionValue, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { theme } from '@/theme';
import { useChrome } from '@/lib/chrome';
import { CONTENT_MAX_WIDTH } from '@/lib/useBreakpoint';
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
  /** Override the centered content cap inside the coach web shell (default 1240). */
  maxWidth?: DimensionValue;
};

/**
 * Standard dark screen wrapper: safe-area + app background, optional scroll and
 * default horizontal padding. Replaces the per-screen SafeAreaView + bg boilerplate.
 *
 * Inside the coach desktop shell (CoachWebChrome → `ChromeContext.active`), it drops
 * the safe-area (no notches on web) and centers content in a capped column. For every
 * other path — native, narrow web, client/admin — it renders exactly the mobile tree.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  gradient = false,
  edges = ['top', 'left', 'right'],
  style,
  contentStyle,
  maxWidth = CONTENT_MAX_WIDTH,
}: ScreenProps) {
  const { active } = useChrome();
  const pad: ViewStyle = padded ? { paddingHorizontal: theme.spacing.lg } : {};

  // ---- Coach desktop shell: centered, capped column, no safe-area ----
  if (active) {
    return (
      <View style={[{ flex: 1, backgroundColor: gradient ? 'transparent' : theme.colors.bg }, style]}>
        {gradient ? <GradientBackground /> : null}
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[pad, { paddingBottom: theme.spacing.xxl, alignItems: 'center' }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* contentStyle (gap/paddingTop) rides on the capped column so child spacing
                is preserved while the column itself is centered. */}
            <View style={[{ width: '100%', maxWidth }, contentStyle]}>{children}</View>
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, pad]}>
            <View style={[{ width: '100%', maxWidth, alignSelf: 'center', flex: 1 }, contentStyle]}>
              {children}
            </View>
          </View>
        )}
      </View>
    );
  }

  // ---- Mobile / native / non-coach: unchanged ----
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

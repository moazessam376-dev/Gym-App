import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { theme } from '@/theme';

export type GlassCardProps = {
  children: ReactNode;
  onPress?: () => void;
  padded?: boolean;
  glowColor?: string; // soft neon halo
  style?: ViewStyle;
};

/**
 * Translucent "glass" surface that sits over the screen gradient. Subtle 1px
 * light border + optional neon glow. The default card of the Neon Glassy look.
 */
export function GlassCard({ children, onPress, padded = true, glowColor, style }: GlassCardProps) {
  const base: ViewStyle = {
    backgroundColor: theme.colors.glass,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.glassBorder,
    padding: padded ? theme.spacing.lg : 0,
    ...(glowColor ? theme.glow(glowColor, 18, 0.35) : null),
  };

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, { opacity: pressed ? 0.9 : 1 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { theme } from '@/theme';

export type CardProps = {
  children: ReactNode;
  onPress?: () => void;
  elevated?: boolean;
  padded?: boolean;
  style?: ViewStyle;
};

/** Surface container. Tappable when `onPress` is provided. */
export function Card({ children, onPress, elevated = false, padded = true, style }: CardProps) {
  const base: ViewStyle = {
    backgroundColor: elevated ? theme.colors.surfaceElevated : theme.colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: padded ? theme.spacing.lg : 0,
  };

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [base, { opacity: pressed ? 0.9 : 1 }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

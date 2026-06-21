import { View, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';

export type BadgeTone = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'neutral';

export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  solid?: boolean;
  style?: ViewStyle;
};

const TONE: Record<BadgeTone, string> = {
  primary: theme.colors.primary,
  secondary: theme.colors.secondary,
  success: theme.colors.success,
  danger: theme.colors.danger,
  warning: theme.colors.warning,
  neutral: theme.colors.textMuted,
};

/** Small status pill. `solid` fills with the tone; otherwise a tinted outline. */
export function Badge({ label, tone = 'neutral', solid = false, style }: BadgeProps) {
  const c = TONE[tone];
  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: solid ? c : 'transparent',
          borderColor: c,
          borderWidth: 1,
          borderRadius: theme.radii.full,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 3,
        },
        style,
      ]}
    >
      <Text variant="label" color={solid ? theme.colors.onPrimary : c}>
        {label}
      </Text>
    </View>
  );
}

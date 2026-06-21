import { ActivityIndicator, Pressable, type PressableProps, View, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  left?: React.ReactNode;
};

const BG: Record<ButtonVariant, string> = {
  primary: theme.colors.primary,
  secondary: theme.colors.surfaceElevated,
  ghost: 'transparent',
  danger: theme.colors.danger,
};
const FG: Record<ButtonVariant, string> = {
  primary: theme.colors.onPrimary,
  secondary: theme.colors.text,
  ghost: theme.colors.link,
  danger: theme.colors.white,
};

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = true,
  disabled,
  style,
  left,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const paddingVertical = size === 'lg' ? theme.spacing.lg : theme.spacing.md;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          backgroundColor: BG[variant],
          borderRadius: theme.radii.md,
          paddingVertical,
          paddingHorizontal: theme.spacing.xl,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: theme.spacing.sm,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: theme.colors.border,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={FG[variant]} />
      ) : (
        <>
          {left ? <View>{left}</View> : null}
          <Text variant="bodyStrong" color={FG[variant]}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

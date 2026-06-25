import { Pressable, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { Icon, type IconName } from './Icon';

export type IconButtonProps = {
  name: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  surface?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

/** A tappable icon, optionally on a circular surface chip. */
export function IconButton({
  name,
  onPress,
  size = 22,
  color = theme.colors.text,
  surface = false,
  accessibilityLabel,
  style,
}: IconButtonProps) {
  const dimension = size + theme.spacing.lg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? name}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: surface ? dimension : undefined,
          height: surface ? dimension : undefined,
          borderRadius: theme.radii.full,
          backgroundColor: surface ? theme.colors.surface : 'transparent',
          borderWidth: surface ? 1 : 0,
          borderColor: theme.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

import { Pressable, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';

export type ChipProps = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
};

/** Pill filter/selector chip. Active = primary fill. Used for muscle-group/block filters. */
export function Chip({ label, active = false, onPress, style }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          borderRadius: theme.radii.full,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 7,
          backgroundColor: active ? theme.colors.primary : theme.colors.glass,
          borderWidth: 1,
          borderColor: active ? theme.colors.primary : theme.colors.glassBorder,
        },
        style,
      ]}
    >
      <Text
        variant="caption"
        color={active ? theme.colors.onPrimary : theme.colors.textMuted}
        style={{ textTransform: 'capitalize', fontFamily: theme.fontFamily.bodySemiBold }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

import { Pressable, View, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle;
};

/** Pill segmented control (e.g. Training / Nutrition). Active segment = primary fill. */
export function Segmented<T extends string>({ options, value, onChange, style }: SegmentedProps<T>) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          backgroundColor: theme.colors.glass,
          borderRadius: theme.radii.md,
          borderWidth: 1,
          borderColor: theme.colors.glassBorder,
          padding: 3,
        },
        style,
      ]}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              paddingVertical: 9,
              borderRadius: theme.radii.sm,
              alignItems: 'center',
              backgroundColor: active ? theme.colors.primary : 'transparent',
            }}
          >
            <Text variant="bodyStrong" color={active ? theme.colors.onPrimary : theme.colors.textMuted}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

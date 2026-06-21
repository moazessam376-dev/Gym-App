import { View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/theme';
import { Text } from './Text';

export type DeltaChipProps = { value: number; suffix?: string };

/** A +/- percentage delta with a directional arrow, tinted by sign. */
export function DeltaChip({ value, suffix = '%' }: DeltaChipProps) {
  const up = value >= 0;
  const color = up ? theme.colors.success : theme.colors.danger;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        backgroundColor: up ? 'rgba(0,230,118,0.12)' : 'rgba(255,61,113,0.12)',
        borderRadius: theme.radii.sm,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Ionicons name={up ? 'arrow-up' : 'arrow-down'} size={11} color={color} />
      <Text variant="caption" color={color} style={{ fontFamily: theme.fontFamily.bodyBold }}>
        {Math.abs(value)}
        {suffix}
      </Text>
    </View>
  );
}

export type StatBlockProps = {
  value: string;
  label: string;
  delta?: number;
  valueColor?: string;
  align?: 'flex-start' | 'center';
  style?: ViewStyle;
};

/** A big imposing number + uppercase label + optional delta. */
export function StatBlock({ value, label, delta, valueColor, align = 'flex-start', style }: StatBlockProps) {
  return (
    <View style={[{ gap: 4, alignItems: align }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Text variant="display" color={valueColor ?? theme.colors.text}>
          {value}
        </Text>
        {delta != null ? <DeltaChip value={delta} /> : null}
      </View>
      <Text variant="label" muted>
        {label}
      </Text>
    </View>
  );
}

// A tier label pill — tier-colored text on a tier-at-low-alpha fill, uppercase
// mono (the brand chip style). Tier color comes from theme.tier, never hardcoded.
import { View, type ViewStyle } from 'react-native';
import { theme, type Tier } from '@/theme';
import { Text } from './Text';

/** Hex tier color → an rgba fill at the given alpha (for the soft chip background). */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export type TierChipProps = {
  tier: Tier;
  label: string;
  style?: ViewStyle;
};

export function TierChip({ tier, label, style }: TierChipProps) {
  const c = theme.tier[tier];
  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: tint(c, 0.16),
          borderRadius: 7,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 3,
        },
        style,
      ]}
    >
      <Text
        color={c}
        style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' }}
      >
        {label}
      </Text>
    </View>
  );
}

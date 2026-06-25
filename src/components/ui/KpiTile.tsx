// A coach-dashboard KPI tile — a big mono number + an uppercase mono label on an
// elevated surface. `tone` tints the number (primary = highlighted cyan, warning =
// amber draft/pending, neutral = cloud). Optional leading line icon.
import { View, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export type KpiTone = 'primary' | 'warning' | 'neutral';

export type KpiTileProps = {
  value: string | number;
  label: string;
  tone?: KpiTone;
  icon?: IconName;
  onPress?: () => void;
  style?: ViewStyle;
};

const TONE: Record<KpiTone, string> = {
  primary: theme.colors.primary,
  warning: theme.colors.warning,
  neutral: theme.colors.text,
};

export function KpiTile({ value, label, tone = 'neutral', icon, onPress: _onPress, style }: KpiTileProps) {
  const c = TONE[tone];
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: theme.colors.surfaceElevated,
          borderWidth: 1,
          borderColor: tone === 'primary' ? theme.colors.primary : theme.colors.border,
          borderRadius: theme.radii.lg,
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={20} color={c} /> : null}
      <Text variant="display" color={c} style={{ fontSize: 30, lineHeight: 34 }}>
        {value}
      </Text>
      <Text variant="label" muted>
        {label}
      </Text>
    </View>
  );
}

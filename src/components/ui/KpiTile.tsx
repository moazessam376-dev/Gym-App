// A coach-dashboard KPI tile — a big mono number + an uppercase mono label on an
// elevated surface. `tone` tints the number (primary = highlighted cyan, warning =
// amber draft/pending, neutral = cloud). Optional leading line icon.
import { Pressable, View, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export type KpiTone = 'primary' | 'warning' | 'neutral';

export type KpiTileProps = {
  value: string | number;
  label: string;
  tone?: KpiTone;
  /** Explicit number color — overrides `tone` (e.g. success/warning/danger thresholds). */
  valueColor?: string;
  /** Optional small caption under the label (e.g. "last 30 days"). */
  note?: string;
  icon?: IconName;
  onPress?: () => void;
  style?: ViewStyle;
};

const TONE: Record<KpiTone, string> = {
  primary: theme.colors.primary,
  warning: theme.colors.warning,
  neutral: theme.colors.text,
};

export function KpiTile({ value, label, tone = 'neutral', valueColor, note, icon, onPress, style }: KpiTileProps) {
  const c = valueColor ?? TONE[tone];
  const Container = onPress ? Pressable : View;
  return (
    <Container
      onPress={onPress}
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
      {icon ? <Icon name={icon} size={20} color={tone === 'primary' ? theme.colors.primary : c} /> : null}
      <Text variant="display" color={c} style={{ fontSize: 30, lineHeight: 34 }}>
        {value}
      </Text>
      <Text variant="label" muted>
        {label}
      </Text>
      {note ? (
        <Text variant="caption" muted style={{ fontSize: 11 }}>
          {note}
        </Text>
      ) : null}
    </Container>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';
import { Button } from './Button';

export type EmptyStateProps = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Friendly placeholder for empty lists / not-yet-built surfaces. */
export function EmptyState({ icon = 'sparkles-outline', title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xxl, gap: theme.spacing.md }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: theme.radii.full,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={28} color={theme.colors.textMuted} />
      </View>
      <Text variant="title" align="center">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="body" muted align="center">
          {subtitle}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} fullWidth={false} style={{ marginTop: theme.spacing.sm }} />
      ) : null}
    </View>
  );
}

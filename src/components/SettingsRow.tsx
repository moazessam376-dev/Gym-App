// Shared list primitives for the Account + Settings hubs (extracted from the old
// account.tsx so both screens render identical rows). A LinkRow is a tappable
// surface card with a leading brand icon and a writing-direction-aware chevron.
import { Pressable } from 'react-native';
import { forwardChevron } from '../lib/rtl';
import { Icon, type IconName, Text } from './ui';
import { theme } from '../theme';

export function SettingsSectionLabel({ children }: { children: string }) {
  return (
    <Text variant="label" muted style={{ marginTop: theme.spacing.md, marginBottom: theme.spacing.xs }}>
      {children}
    </Text>
  );
}

export function SettingsLinkRow({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Icon name={icon} size={20} color={theme.colors.primary} />
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        {label}
      </Text>
      <Icon name={forwardChevron()} size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
}

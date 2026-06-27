// A bottom-sheet offering the two ways to remove a workout note (0060). The athlete
// authored the note on an exercise; it was also mirrored into the coach chat as a note
// card. So "delete" is two distinct intents:
//   • Hide from my log    — keep the coach's chat copy; just drop it from my view.
//   • Delete for everyone  — also retract the chat note card (destructive).
// Presentational: the parent owns the targeted note and performs the work.
import { Modal, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName, Text } from './ui';
import { theme } from '../theme';

export function NoteDeleteSheet({
  visible,
  busy,
  onHide,
  onDeleteEveryone,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
  onHide: () => void;
  onDeleteEveryone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={busy ? undefined : onClose}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        {/* Stop propagation so taps inside the sheet don't dismiss it. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.colors.surfaceElevated,
            borderTopLeftRadius: theme.radii.xl,
            borderTopRightRadius: theme.radii.xl,
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.lg,
            paddingBottom: theme.spacing.xxl,
            gap: theme.spacing.sm,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
          }}
        >
          <Text variant="bodyStrong" style={{ marginBottom: theme.spacing.xs }}>
            {t('workout.noteRemoveTitle')}
          </Text>

          <Action
            icon="eye-off"
            label={t('workout.hideFromLog')}
            hint={t('workout.hideFromLogHint')}
            onPress={onHide}
            busy={busy}
          />
          <Action
            icon="trash"
            label={t('workout.deleteForEveryone')}
            hint={t('workout.deleteForEveryoneHint')}
            onPress={onDeleteEveryone}
            busy={busy}
            danger
          />

          <Pressable
            onPress={busy ? undefined : onClose}
            style={{ paddingVertical: theme.spacing.md, alignItems: 'center', marginTop: theme.spacing.xs }}
          >
            <Text variant="bodyStrong" muted>
              {t('common.cancel')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Action({
  icon,
  label,
  hint,
  onPress,
  busy,
  danger,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress: () => void;
  busy: boolean;
  danger?: boolean;
}) {
  const tint = danger ? theme.colors.danger : theme.colors.primary;
  return (
    <Pressable
      onPress={() => !busy && onPress()}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed || busy ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={20} color={tint} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" color={danger ? theme.colors.danger : theme.colors.text}>
          {label}
        </Text>
        <Text variant="caption" muted>
          {hint}
        </Text>
      </View>
    </Pressable>
  );
}

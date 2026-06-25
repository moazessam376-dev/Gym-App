// A bottom-sheet of per-message actions (Phase 18 Slice 2). Long-pressing a chat
// bubble opens this: a quick-reaction emoji row (always), plus Edit (your own, recent
// message) and Report (an incoming message). Presentational — the parent owns which
// message is targeted and performs the work; choosing Report hands off to the
// existing reason picker (ReportMessageSheet).
import { Modal, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { REACTION_EMOJIS, type ReactionEmoji } from '../schemas/message';
import { Emoji } from './Emoji';
import { Icon, type IconName, Text } from './ui';
import { theme } from '../theme';

export function MessageActionsSheet({
  visible,
  mine,
  canEdit,
  canReact,
  canReply,
  myReactions,
  busy,
  onReact,
  onReply,
  onEdit,
  onReport,
  onClose,
}: {
  visible: boolean;
  mine: boolean;
  canEdit: boolean;
  canReact: boolean;
  canReply: boolean;
  myReactions: ReactionEmoji[];
  busy: boolean;
  onReact: (emoji: ReactionEmoji) => void;
  onReply: () => void;
  onEdit: () => void;
  onReport: () => void;
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
          {/* Quick-react row (hidden when the viewer can't react, e.g. banned). */}
          {canReact ? (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-around',
              alignItems: 'center',
              paddingVertical: theme.spacing.sm,
              marginBottom: theme.spacing.xs,
            }}
          >
            {REACTION_EMOJIS.map((emoji) => {
              const active = myReactions.includes(emoji);
              return (
                <Pressable
                  key={emoji}
                  onPress={() => !busy && onReact(emoji)}
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    borderRadius: theme.radii.full,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? theme.colors.primary : theme.colors.surface,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    opacity: busy ? 0.7 : 1,
                    transform: [{ scale: pressed ? 0.86 : 1 }],
                  })}
                >
                  <Emoji char={emoji} size={26} />
                </Pressable>
              );
            })}
          </View>
          ) : null}

          {canReply ? (
            <Action icon="arrow-undo-outline" label={t('chat.replyAction')} onPress={onReply} busy={busy} />
          ) : null}
          {canEdit ? (
            <Action icon="create-outline" label={t('chat.editAction')} onPress={onEdit} busy={busy} />
          ) : null}
          {!mine ? (
            <Action
              icon="flag-outline"
              label={t('chat.reportAction')}
              onPress={onReport}
              busy={busy}
              danger
            />
          ) : null}

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
  onPress,
  busy,
  danger,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  busy: boolean;
  danger?: boolean;
}) {
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
      <Icon name={icon} size={20} color={danger ? theme.colors.danger : theme.colors.primary} />
      <Text variant="bodyStrong" color={danger ? theme.colors.danger : theme.colors.text} style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

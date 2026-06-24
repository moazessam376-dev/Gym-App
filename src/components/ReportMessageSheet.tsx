// A bottom-sheet reason picker for reporting a chat message (Phase 18 safety).
// Presentational: the parent owns which message is being reported and performs the
// report call on pick. Includes the in-product policy line (§8 safety copy).
import { Modal, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { REPORT_REASONS, type ReportReason } from '../schemas/moderation';
import { Text } from './ui';
import { theme } from '../theme';

const REASON_ICON: Record<ReportReason, keyof typeof Ionicons.glyphMap> = {
  harassment: 'warning-outline',
  spam: 'mail-unread-outline',
  inappropriate: 'eye-off-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

export function ReportMessageSheet({
  visible,
  busy,
  onPick,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
  onPick: (reason: ReportReason) => void;
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
          <Text variant="title">{t('report.title')}</Text>
          <Text variant="caption" muted style={{ marginBottom: theme.spacing.sm }}>
            {t('report.policy')}
          </Text>

          {REPORT_REASONS.map((reason) => (
            <Pressable
              key={reason}
              onPress={() => !busy && onPick(reason)}
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
              <Ionicons name={REASON_ICON[reason]} size={20} color={theme.colors.primary} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {t(`report.reasons.${reason}`)}
              </Text>
            </Pressable>
          ))}

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

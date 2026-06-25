// A bottom-sheet reason picker for reporting a chat message (Phase 18 safety).
// Presentational: the parent owns which message is being reported and performs the
// report call on pick. Includes the in-product policy line (§8 safety copy).
import { Modal, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { REPORT_REASONS, type ReportReason } from '../schemas/moderation';
import { Icon, type IconName, Text } from './ui';
import { theme } from '../theme';

const REASON_ICON: Record<ReportReason, IconName> = {
  harassment: 'warning',
  spam: 'mail',
  inappropriate: 'eye-off',
  other: 'more',
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
  const router = useRouter();
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
          <Text variant="caption" muted>
            {t('report.policy')}
          </Text>
          <Pressable
            onPress={() => {
              onClose();
              router.push('/community-guidelines');
            }}
            hitSlop={8}
            style={{ marginBottom: theme.spacing.sm }}
          >
            <Text variant="caption" color={theme.colors.primary}>
              {t('chat.readGuidelines')}
            </Text>
          </Pressable>

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
              <Icon name={REASON_ICON[reason]} size={20} color={theme.colors.primary} />
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

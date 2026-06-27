// A bottom-sheet for a client to request a coach with an optional note (Slice G2).
// Presentational: the parent owns submission. The note is plain text (never HTML, §8).
// Follows the app's Modal sheet pattern (see BanAppealSheet / ReportMessageSheet).
import { useState } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text, Button } from './ui';
import { textStart } from '../lib/rtl';
import { theme } from '../theme';

export function RequestCoachSheet({
  visible,
  busy,
  coachName,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
  coachName: string | null;
  onSubmit: (note: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');

  function close() {
    if (busy) return;
    setNote('');
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        onPress={close}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.colors.surfaceElevated,
            borderTopLeftRadius: theme.radii.xl,
            borderTopRightRadius: theme.radii.xl,
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.lg,
            paddingBottom: theme.spacing.xxl,
            gap: theme.spacing.md,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
          }}
        >
          <Text variant="title" style={textStart}>
            {t('coachRequest.sheetTitle', { name: coachName ?? t('coachRequest.thisCoach') })}
          </Text>
          <Text variant="caption" muted style={textStart}>
            {t('coachRequest.sheetPrompt')}
          </Text>

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t('coachRequest.notePlaceholder')}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={500}
            editable={!busy}
            style={{
              minHeight: 88,
              textAlignVertical: 'top',
              color: theme.colors.text,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.spacing.md,
              fontFamily: theme.fontFamily.bodyRegular,
            }}
          />

          <Button
            title={t('coachRequest.send')}
            onPress={() => onSubmit(note.trim())}
            loading={busy}
          />
          <Pressable onPress={close} style={{ alignItems: 'center', paddingVertical: theme.spacing.sm }}>
            <Text variant="bodyStrong" muted>
              {t('common.cancel')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

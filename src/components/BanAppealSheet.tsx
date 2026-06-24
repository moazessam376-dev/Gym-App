// A bottom-sheet for a banned user to appeal their ban (Phase 18 Slice 3).
// Presentational: the parent owns submission; this collects the appeal note. The
// note is plain text and must never be rendered as HTML (§8).
import { useState } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text, Button } from './ui';
import { theme } from '../theme';

export function BanAppealSheet({
  visible,
  busy,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
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
            gap: theme.spacing.md,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
          }}
        >
          <Text variant="title">{t('appeal.title')}</Text>
          <Text variant="caption" muted>
            {t('appeal.prompt')}
          </Text>

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t('appeal.notePlaceholder')}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={1000}
            editable={!busy}
            style={{
              minHeight: 96,
              maxHeight: 160,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.lg,
              paddingHorizontal: theme.spacing.lg,
              paddingTop: theme.spacing.md,
              paddingBottom: theme.spacing.md,
              color: theme.colors.text,
              fontFamily: theme.fontFamily.bodyRegular,
              fontSize: 15,
              textAlignVertical: 'top',
            }}
          />

          <Button
            title={t('appeal.submit')}
            onPress={() => onSubmit(note.trim())}
            loading={busy}
            disabled={busy || note.trim().length === 0}
          />
          <Pressable
            onPress={close}
            style={{ paddingVertical: theme.spacing.sm, alignItems: 'center' }}
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

// BookCallSheet — the client's "Book a call" bottom sheet, built from the design mockup
// (Brand Identity/Raptor_call_booking_mockup.html). Purpose chips → duration filter → date
// strip → available-times grid → "Request call". Submitting is a plain RLS insert (the
// server sets origin/parties/status + validates the slot); the coach approves from their
// inbox. Mirrors MessageActionsSheet's Modal pattern (backdrop closes; inner Pressable stops
// propagation) and carries its OWN useTranslation. All copy is t()'d (calls.*).
import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Chip, Segmented, Text, useToast } from '../ui';
import { theme } from '../../theme';
import { textStart } from '../../lib/rtl';
import { queryClient } from '../../lib/query';
import {
  CALL_PURPOSES,
  SLOT_TAKEN,
  createCallRequest,
  type CallPurpose,
  type CoachCallSlot,
} from '../../lib/calls';
import { useCoachOpenSlots } from '../../lib/queries/calls';

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function fmtWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short' });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function BookCallSheet({
  visible,
  onClose,
  coachName,
}: {
  visible: boolean;
  onClose: () => void;
  coachName?: string | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const slotsQ = useCoachOpenSlots(visible);
  const [purpose, setPurpose] = useState<CallPurpose>('progress_review');
  const [durationSel, setDurationSel] = useState<string | null>(null);
  const [dateSel, setDateSel] = useState<string | null>(null);
  const [slotSel, setSlotSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slots: CoachCallSlot[] = slotsQ.data ?? [];
  const durations = Array.from(new Set(slots.map((s) => s.duration_minutes))).sort((a, b) => a - b);
  const duration = durationSel && durations.includes(Number(durationSel)) ? Number(durationSel) : durations[0];

  const byDuration = slots.filter((s) => s.duration_minutes === duration);
  const dates = Array.from(new Set(byDuration.map((s) => dayKey(s.starts_at))));
  const date = dateSel && dates.includes(dateSel) ? dateSel : dates[0];
  const dateLabel = (key: string) => byDuration.find((s) => dayKey(s.starts_at) === key)?.starts_at;

  const daySlots = byDuration.filter((s) => dayKey(s.starts_at) === date);
  const slot = daySlots.find((s) => s.id === slotSel) ?? null;

  const reset = () => {
    setPurpose('progress_review');
    setDurationSel(null);
    setDateSel(null);
    setSlotSel(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (!slot) return;
    setBusy(true);
    try {
      await createCallRequest(slot.id, purpose);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-calls'] }),
        queryClient.invalidateQueries({ queryKey: ['coach-open-slots'] }),
      ]);
      toast.show(t('calls.book.success'));
      reset();
      onClose();
    } catch (e) {
      const msg = (e as Error)?.message;
      toast.show(msg === SLOT_TAKEN ? t('calls.book.slotTaken') : t('calls.error.generic'), 'error');
      if (msg === SLOT_TAKEN) slotsQ.refetch();
    } finally {
      setBusy(false);
    }
  };

  const label = (k: string) => <Text variant="label" muted style={[textStart, { marginBottom: theme.spacing.sm }]}>{k}</Text>;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        onPress={close}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,6,9,0.72)' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radii.xl,
            borderTopRightRadius: theme.radii.xl,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.xxl,
            maxHeight: '88%',
          }}
        >
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.glassBorder, alignSelf: 'center', marginBottom: theme.spacing.lg }} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, marginBottom: theme.spacing.lg }}>
            <Avatar name={coachName ?? undefined} size={46} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="title" style={textStart}>
                {coachName ? t('calls.book.title', { name: coachName }) : t('calls.book.titleNoName')}
              </Text>
              <Text variant="caption" muted style={textStart}>{t('calls.book.subtitle')}</Text>
            </View>
          </View>

          {slotsQ.isPending ? (
            <Text variant="caption" muted style={textStart}>…</Text>
          ) : slots.length === 0 ? (
            <Text variant="body" muted style={[textStart, { paddingVertical: theme.spacing.lg }]}>
              {t('calls.book.noSlots')}
            </Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {/* Purpose */}
              {label(t('calls.book.purpose'))}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.lg }}>
                {CALL_PURPOSES.map((p) => (
                  <Chip key={p} label={t(`calls.purpose.${p}`)} active={purpose === p} onPress={() => setPurpose(p)} />
                ))}
              </View>

              {/* Duration filter (only when the coach offers more than one length) */}
              {durations.length > 1 ? (
                <>
                  {label(t('calls.book.duration'))}
                  <View style={{ marginBottom: theme.spacing.lg }}>
                    <Segmented
                      options={durations.map((d) => ({ value: String(d), label: t('calls.book.minutes', { count: d }) }))}
                      value={String(duration)}
                      onChange={(v) => { setDurationSel(v); setDateSel(null); setSlotSel(null); }}
                    />
                  </View>
                </>
              ) : null}

              {/* Date strip */}
              {label(t('calls.book.date'))}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: theme.spacing.lg }}>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  {dates.map((key) => {
                    const iso = dateLabel(key)!;
                    const active = key === date;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => { setDateSel(key); setSlotSel(null); }}
                        style={{
                          minWidth: 56,
                          alignItems: 'center',
                          paddingVertical: theme.spacing.sm,
                          paddingHorizontal: theme.spacing.md,
                          borderRadius: theme.radii.md,
                          borderWidth: 1,
                          backgroundColor: active ? theme.colors.primary : theme.colors.surfaceElevated,
                          borderColor: active ? theme.colors.primary : theme.colors.glassBorder,
                        }}
                      >
                        <Text variant="label" color={active ? theme.colors.onPrimary : theme.colors.textMuted}>{fmtWeekday(iso)}</Text>
                        <Text variant="title" color={active ? theme.colors.onPrimary : theme.colors.text}>{new Date(iso).getDate()}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Time grid */}
              {label(t('calls.book.availableTimes'))}
              {daySlots.length === 0 ? (
                <Text variant="caption" muted style={[textStart, { marginBottom: theme.spacing.lg }]}>{t('calls.book.noSlotsForDay')}</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.lg }}>
                  {daySlots.map((s) => {
                    const active = s.id === slot?.id;
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => setSlotSel(s.id)}
                        style={{
                          minWidth: 84,
                          alignItems: 'center',
                          paddingVertical: theme.spacing.md,
                          paddingHorizontal: theme.spacing.md,
                          borderRadius: theme.radii.md,
                          borderWidth: 1,
                          backgroundColor: active ? theme.colors.primary : theme.colors.surfaceElevated,
                          borderColor: active ? theme.colors.primary : theme.colors.glassBorder,
                        }}
                      >
                        <Text variant="bodyStrong" color={active ? theme.colors.onPrimary : theme.colors.text}>{fmtTime(s.starts_at)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Button
                title={
                  slot
                    ? t('calls.book.requestWhen', { when: `${fmtWeekday(slot.starts_at)} ${fmtTime(slot.starts_at)}` })
                    : t('calls.book.request')
                }
                onPress={submit}
                disabled={!slot}
                loading={busy}
                fullWidth
              />
              <View style={{ height: theme.spacing.sm }} />
              <Button title={t('common.cancel')} variant="ghost" onPress={close} fullWidth />
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

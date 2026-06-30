// BookCallSheet — the client's "Book a call" bottom sheet (Calendly-style). The client picks a
// purpose + a duration (15/30/45/60), then a day + a time. Times come from TWO sources merged:
//   • the coach's weekly WORKING HOURS (coach_availability) → flexible-duration times, computed
//     client-side (deriveBookableTimes) minus already-booked times (coach_booked_times); and
//   • any one-off ad-hoc SLOTS the coach opened at that duration.
// Booking a working-hours time inserts {scheduled_at,duration,purpose}; booking a slot inserts
// {slot_id,purpose}. Either way the server sets origin/parties/status + validates; the coach
// approves from their inbox. Mirrors MessageActionsSheet's Modal pattern; own useTranslation.
import { useMemo, useState } from 'react';
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
  createCallRequestAtTime,
  deriveBookableTimes,
  type CallPurpose,
  type CoachAvailability,
  type CoachCallSlot,
} from '../../lib/calls';
import { useCoachAvailability, useCoachBookedTimes, useCoachOpenSlots } from '../../lib/queries/calls';

const DURATIONS = [15, 30, 45, 60];

type TimeOption = { kind: 'slot' | 'time'; at: Date; slotId?: string; key: string };

const dayKeyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const fmtWeekdayD = (d: Date) => d.toLocaleDateString([], { weekday: 'short' });
const fmtTimeD = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

/** Merge working-hours derived times + ad-hoc slots for one duration, dedup by exact start
 *  (an explicit slot wins over a derived time at the same instant), soonest first. */
function buildOptions(
  duration: number,
  windows: CoachAvailability[],
  booked: { scheduled_at: string; duration_minutes: number | null }[],
  slots: CoachCallSlot[],
): TimeOption[] {
  const byTs = new Map<number, TimeOption>();
  for (const d of deriveBookableTimes(windows, booked, duration)) {
    byTs.set(d.getTime(), { kind: 'time', at: d, key: `t-${d.getTime()}` });
  }
  for (const s of slots) {
    if (s.duration_minutes !== duration) continue;
    const d = new Date(s.starts_at);
    byTs.set(d.getTime(), { kind: 'slot', at: d, slotId: s.id, key: `s-${s.id}` });
  }
  return [...byTs.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function BookCallSheet({
  visible,
  onClose,
  coachName,
  coachId,
}: {
  visible: boolean;
  onClose: () => void;
  coachName?: string | null;
  coachId?: string | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const slotsQ = useCoachOpenSlots(visible);
  const availQ = useCoachAvailability(visible);
  const [purpose, setPurpose] = useState<CallPurpose>('progress_review');
  const [durationSel, setDurationSel] = useState<number | null>(null);
  const [dateSel, setDateSel] = useState<string | null>(null);
  const [optSel, setOptSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slots: CoachCallSlot[] = slotsQ.data ?? [];
  const windows: CoachAvailability[] = availQ.data ?? [];
  // Self-derive the coach (for the busy-times query) from whichever source loaded.
  const derivedCoachId = coachId ?? windows[0]?.coach_id ?? slots[0]?.coach_id ?? null;
  const bookedQ = useCoachBookedTimes(derivedCoachId, visible);
  const booked = bookedQ.data ?? [];

  const hasAvailability = slots.length > 0 || windows.length > 0;

  const optionsByDuration = useMemo(() => {
    const m = new Map<number, TimeOption[]>();
    for (const d of DURATIONS) m.set(d, buildOptions(d, windows, booked, slots));
    return m;
  }, [windows, booked, slots]);

  // Default to 30 min if it has times, else the first duration that does.
  const defaultDuration =
    ((optionsByDuration.get(30)?.length ?? 0) > 0 ? 30 : undefined) ??
    DURATIONS.find((d) => (optionsByDuration.get(d)?.length ?? 0) > 0) ??
    30;
  const duration = durationSel ?? defaultDuration;

  const options = optionsByDuration.get(duration) ?? [];
  const dates = Array.from(new Set(options.map((o) => dayKeyOf(o.at))));
  const date = dateSel && dates.includes(dateSel) ? dateSel : dates[0] ?? null;
  const dayOptions = options.filter((o) => dayKeyOf(o.at) === date);
  const selected = dayOptions.find((o) => o.key === optSel) ?? null;

  const reset = () => {
    setPurpose('progress_review');
    setDurationSel(null);
    setDateSel(null);
    setOptSel(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      if (selected.kind === 'slot') await createCallRequest(selected.slotId!, purpose);
      else await createCallRequestAtTime(selected.at.toISOString(), duration, purpose);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-calls'] }),
        queryClient.invalidateQueries({ queryKey: ['coach-open-slots'] }),
        queryClient.invalidateQueries({ queryKey: ['coach-booked-times', derivedCoachId ?? null] }),
      ]);
      toast.show(t('calls.book.success'));
      reset();
      onClose();
    } catch (e) {
      const msg = (e as Error)?.message;
      toast.show(msg === SLOT_TAKEN ? t('calls.book.slotTaken') : t('calls.error.generic'), 'error');
      if (msg === SLOT_TAKEN) {
        slotsQ.refetch();
        bookedQ.refetch();
      }
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

          {slotsQ.isPending || availQ.isPending ? (
            <Text variant="caption" muted style={textStart}>…</Text>
          ) : !hasAvailability ? (
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

              {/* Duration (flexible — the booking length the client wants) */}
              {label(t('calls.book.duration'))}
              <View style={{ marginBottom: theme.spacing.lg }}>
                <Segmented
                  options={DURATIONS.map((d) => ({ value: String(d), label: t('calls.book.minutes', { count: d }) }))}
                  value={String(duration)}
                  onChange={(v) => { setDurationSel(Number(v)); setDateSel(null); setOptSel(null); }}
                />
              </View>

              {options.length === 0 ? (
                <Text variant="body" muted style={[textStart, { paddingVertical: theme.spacing.md }]}>{t('calls.book.noTimesForDuration')}</Text>
              ) : (
                <>
                  {/* Date strip */}
                  {label(t('calls.book.date'))}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: theme.spacing.lg }}>
                    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                      {dates.map((key) => {
                        const at = options.find((o) => dayKeyOf(o.at) === key)!.at;
                        const active = key === date;
                        return (
                          <Pressable
                            key={key}
                            onPress={() => { setDateSel(key); setOptSel(null); }}
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
                            <Text variant="label" color={active ? theme.colors.onPrimary : theme.colors.textMuted}>{fmtWeekdayD(at)}</Text>
                            <Text variant="title" color={active ? theme.colors.onPrimary : theme.colors.text}>{at.getDate()}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>

                  {/* Time grid */}
                  {label(t('calls.book.availableTimes'))}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.lg }}>
                    {dayOptions.map((o) => {
                      const active = o.key === selected?.key;
                      return (
                        <Pressable
                          key={o.key}
                          onPress={() => setOptSel(o.key)}
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
                          <Text variant="bodyStrong" color={active ? theme.colors.onPrimary : theme.colors.text}>{fmtTimeD(o.at)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              <Button
                title={
                  selected
                    ? t('calls.book.requestWhen', { when: `${fmtWeekdayD(selected.at)} ${fmtTimeD(selected.at)}` })
                    : t('calls.book.request')
                }
                onPress={submit}
                disabled={!selected}
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

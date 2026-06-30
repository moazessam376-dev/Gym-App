// AvailabilityCalendar — a month-grid availability editor for the coach (Calendly-style).
// Tap any day (weekends included), then add/manage time slots for that day. Replaces the
// old YYYY-MM-DD text form. Custom grid (no calendar dep) matching the design system.
// Module-scope component → its OWN useTranslation.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Badge, Button, GlassCard, Icon, Input, Segmented, Text, useToast, type BadgeTone } from '../ui';
import { theme } from '../../theme';
import { textStart, forwardChevron } from '../../lib/rtl';
import { confirm } from '../../lib/confirm';
import {
  closeSlot,
  createSlot,
  deleteSlot,
  reopenSlot,
  type CoachCallSlot,
  type SlotStatus,
} from '../../lib/calls';

const SLOT_TONE: Record<SlotStatus, BadgeTone> = {
  open: 'success',
  held: 'warning',
  booked: 'primary',
  closed: 'neutral',
};

const pad = (n: number) => String(n).padStart(2, '0');
const dayKeyLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayKeyOfIso = (iso: string) => dayKeyLocal(new Date(iso));
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

function monthCells(view: Date): (Date | null)[] {
  const y = view.getFullYear();
  const m = view.getMonth();
  const startWeekday = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// Locale-aware narrow weekday labels (2023-01-01 is a Sunday).
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2023, 0, 1 + i).toLocaleDateString([], { weekday: 'narrow' }),
);

function DaySlotRow({ slot, busy, onAction }: { slot: CoachCallSlot; busy: boolean; onAction: (fn: () => Promise<void>) => () => void }) {
  const { t } = useTranslation();
  const locked = slot.status === 'held' || slot.status === 'booked';
  const remove = onAction(async () => {
    const ok = await confirm(t('calls.availability.deleteConfirm'), '', t('calls.availability.delete'), t('common.cancel'));
    if (!ok) throw new Error('cancelled-by-user');
    await deleteSlot(slot.id);
  });
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.glassBorder, paddingTop: theme.spacing.sm, gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {fmtTime(slot.starts_at)} · {t('calls.book.minutes', { count: slot.duration_minutes })}
        </Text>
        <Badge label={t(`calls.availability.slot.${slot.status}`)} tone={SLOT_TONE[slot.status]} />
      </View>
      {!locked ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            {slot.status === 'open' ? (
              <Button title={t('calls.availability.close')} variant="ghost" onPress={onAction(() => closeSlot(slot.id))} disabled={busy} />
            ) : (
              <Button title={t('calls.availability.reopen')} variant="ghost" onPress={onAction(() => reopenSlot(slot.id))} disabled={busy} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Button title={t('calls.availability.delete')} variant="danger" onPress={remove} disabled={busy} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function AvailabilityCalendar({
  slots,
  coachId,
  onChanged,
}: {
  slots: CoachCallSlot[];
  coachId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const today = new Date();
  const todayKey = dayKeyLocal(today);
  const [view, setView] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<string>(todayKey);
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('30');
  const [busy, setBusy] = useState(false);

  const byDay = new Map<string, CoachCallSlot[]>();
  for (const s of slots) {
    const k = dayKeyOfIso(s.starts_at);
    const arr = byDay.get(k);
    if (arr) arr.push(s);
    else byDay.set(k, [s]);
  }

  const cells = monthCells(view);
  const rows = Array.from({ length: cells.length / 7 }, (_, r) => cells.slice(r * 7, r * 7 + 7));
  const monthLabel = view.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const daySlots = (byDay.get(selected) ?? []).slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const shiftMonth = (delta: number) => setView(new Date(view.getFullYear(), view.getMonth() + delta, 1));

  const runAction = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      if ((e as Error)?.message !== 'cancelled-by-user') toast.show(t('calls.error.generic'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addSlot = async () => {
    if (!/^\d{2}:\d{2}$/.test(time.trim())) {
      toast.show(t('calls.availability.invalidTime'), 'error');
      return;
    }
    const d = new Date(`${selected}T${time.trim()}:00`);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      toast.show(t('calls.availability.invalidTime'), 'error');
      return;
    }
    setBusy(true);
    try {
      await createSlot(coachId, d.toISOString(), Number(duration));
      setTime('');
      onChanged();
    } catch {
      toast.show(t('calls.error.generic'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: theme.spacing.lg }}>
      {/* ── Month grid ─────────────────────────────────────────────── */}
      <GlassCard style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={() => shiftMonth(-1)} hitSlop={12}>
            <Icon name={forwardChevron() === 'chevron-forward' ? 'chevron-back' : 'chevron-forward'} size={22} color={theme.colors.text} />
          </Pressable>
          <Text variant="title">{monthLabel}</Text>
          <Pressable onPress={() => shiftMonth(1)} hitSlop={12}>
            <Icon name={forwardChevron()} size={22} color={theme.colors.text} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row' }}>
          {WEEKDAYS.map((w, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="label" muted>{w}</Text>
            </View>
          ))}
        </View>

        <View style={{ gap: 4 }}>
          {rows.map((week, r) => (
            <View key={r} style={{ flexDirection: 'row' }}>
              {week.map((cell, c) => {
                if (!cell) return <View key={c} style={{ flex: 1, height: 44 }} />;
                const k = dayKeyLocal(cell);
                const isPast = k < todayKey;
                const isSelected = k === selected;
                const isToday = k === todayKey;
                const has = (byDay.get(k) ?? []).length > 0;
                return (
                  <Pressable
                    key={c}
                    disabled={isPast}
                    onPress={() => setSelected(k)}
                    style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', opacity: isPast ? 0.32 : 1 }}
                  >
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                        borderWidth: isToday && !isSelected ? 1 : 0,
                        borderColor: theme.colors.primary,
                      }}
                    >
                      <Text variant="bodyStrong" color={isSelected ? theme.colors.onPrimary : theme.colors.text}>
                        {cell.getDate()}
                      </Text>
                    </View>
                    <View
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 3,
                        marginTop: 3,
                        backgroundColor: has ? (isSelected ? theme.colors.onPrimary : theme.colors.primary) : 'transparent',
                      }}
                    />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </GlassCard>

      {/* ── Selected-day panel ─────────────────────────────────────── */}
      <GlassCard style={{ gap: theme.spacing.md }}>
        <Text variant="bodyStrong" style={textStart}>
          {t('calls.availability.daySlots', {
            date: new Date(`${selected}T00:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }),
          })}
        </Text>

        <Input label={t('calls.availability.time')} value={time} onChangeText={setTime} placeholder="HH:MM" autoCapitalize="none" />
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="label" muted style={textStart}>{t('calls.availability.duration')}</Text>
          <Segmented
            options={['15', '30', '45', '60'].map((d) => ({ value: d, label: t('calls.book.minutes', { count: Number(d) }) }))}
            value={duration}
            onChange={setDuration}
          />
        </View>
        <Button title={t('calls.availability.add')} onPress={addSlot} loading={busy} fullWidth />

        {daySlots.length === 0 ? (
          <Text variant="caption" muted style={textStart}>{t('calls.availability.noDaySlots')}</Text>
        ) : (
          daySlots.map((s) => <DaySlotRow key={s.id} slot={s} busy={busy} onAction={runAction} />)
        )}
      </GlassCard>
    </View>
  );
}

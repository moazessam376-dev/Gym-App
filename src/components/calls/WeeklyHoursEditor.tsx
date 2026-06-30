// WeeklyHoursEditor — Calendly-style recurring availability. The coach toggles each weekday
// and sets a start time + window length (4h/8h); clients then book any free time inside those
// windows at their own chosen duration. The ad-hoc month-grid (AvailabilityCalendar) stays for
// one-off slots outside these hours. Module-scope rows get their OWN useTranslation.
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, GlassCard, Input, Segmented, Text, useToast } from '../ui';
import { theme } from '../../theme';
import { textStart } from '../../lib/rtl';
import { clearCoachAvailabilityDay, setCoachAvailability, type CoachAvailability } from '../../lib/calls';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]; // 0=Sunday (JS getDay)

const pad = (n: number) => String(n).padStart(2, '0');
const fmtMin = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const am = h < 12;
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${pad(m)} ${am ? 'AM' : 'PM'}`;
};
const parseHHMM = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
};

function DayRow({ weekday, win, coachId, onChanged }: { weekday: number; win?: CoachAvailability; coachId: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(win ? `${pad(Math.floor(win.start_minute / 60))}:${pad(win.start_minute % 60)}` : '09:00');
  const [length, setLength] = useState(win ? String(Math.round((win.end_minute - win.start_minute) / 60)) : '8');
  const [busy, setBusy] = useState(false);
  const dayName = new Date(2023, 0, 1 + weekday).toLocaleDateString([], { weekday: 'long' });

  const save = async () => {
    const sm = parseHHMM(start);
    if (sm == null) {
      toast.show(t('calls.availability.invalidTime'), 'error');
      return;
    }
    const em = Math.min(sm + Number(length) * 60, 1440);
    if (em <= sm) {
      toast.show(t('calls.availability.invalidTime'), 'error');
      return;
    }
    setBusy(true);
    try {
      await setCoachAvailability(coachId, weekday, sm, em);
      setEditing(false);
      onChanged();
    } catch {
      toast.show(t('calls.error.generic'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await clearCoachAvailabilityDay(coachId, weekday);
      onChanged();
    } catch {
      toast.show(t('calls.error.generic'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.glassBorder, paddingTop: theme.spacing.sm, gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Text variant="bodyStrong" style={[textStart, { flex: 1, textTransform: 'capitalize' }]}>{dayName}</Text>
        {win && !editing ? (
          <Text variant="caption" muted>{`${fmtMin(win.start_minute)} – ${fmtMin(win.end_minute)}`}</Text>
        ) : null}
      </View>
      {editing ? (
        <>
          <Input label={t('calls.availability.startTime')} value={start} onChangeText={setStart} placeholder="HH:MM" autoCapitalize="none" />
          <Segmented
            options={['4', '8'].map((h) => ({ value: h, label: t('calls.availability.hours', { count: Number(h) }) }))}
            value={length}
            onChange={setLength}
          />
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}><Button title={t('common.cancel')} variant="ghost" onPress={() => setEditing(false)} disabled={busy} /></View>
            <View style={{ flex: 1 }}><Button title={t('common.save')} onPress={save} loading={busy} /></View>
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title={win ? t('calls.availability.editHours') : t('calls.availability.setHours')} variant="ghost" onPress={() => setEditing(true)} disabled={busy} />
          </View>
          {win ? (
            <View style={{ flex: 1 }}>
              <Button title={t('calls.availability.off')} variant="danger" onPress={remove} disabled={busy} />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

export function WeeklyHoursEditor({ windows, coachId, onChanged }: { windows: CoachAvailability[]; coachId: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const byDay = new Map(windows.map((w) => [w.weekday, w]));
  return (
    <GlassCard style={{ gap: theme.spacing.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="bodyStrong" style={textStart}>{t('calls.availability.weeklyTitle')}</Text>
        <Text variant="caption" muted style={textStart}>{t('calls.availability.weeklySub')}</Text>
      </View>
      {WEEKDAYS.map((wd) => (
        <DayRow key={wd} weekday={wd} win={byDay.get(wd)} coachId={coachId} onChanged={onChanged} />
      ))}
    </GlassCard>
  );
}

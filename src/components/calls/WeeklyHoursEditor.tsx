// WeeklyHoursEditor — Calendly-style recurring availability, COMPACT. One thin row per weekday
// with an on/off switch (off = a day off / weekend) and, when on, a From–To time range picked
// via the AM/PM TimeField (no 24h typing). Toggling a day on seeds a default 9 AM–5 PM window;
// changing From/To, or toggling off, saves immediately. Clients then book any free time inside
// these hours at their own duration. Module-scope rows get their OWN useTranslation.
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { GlassCard, Text, TimeField, useToast } from '../ui';
import { theme } from '../../theme';
import { textStart } from '../../lib/rtl';
import { clearCoachAvailabilityDay, setCoachAvailability, type CoachAvailability } from '../../lib/calls';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]; // 0=Sunday (JS getDay)
const DEFAULT_START = 9 * 60; // 9:00 AM
const DEFAULT_END = 17 * 60; // 5:00 PM
const MIN_WINDOW = 15; // a window must be at least 15 min wide

function DayRow({ weekday, win, coachId, onChanged }: { weekday: number; win?: CoachAvailability; coachId: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const dayName = new Date(2023, 0, 1 + weekday).toLocaleDateString([], { weekday: 'long' });
  const on = !!win;

  const persist = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch {
      toast.show(t('calls.error.generic'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (next: boolean) =>
    persist(() =>
      next
        ? setCoachAvailability(coachId, weekday, DEFAULT_START, DEFAULT_END)
        : clearCoachAvailabilityDay(coachId, weekday),
    );

  const setStart = (sm: number) => {
    if (!win) return;
    if (sm + MIN_WINDOW > win.end_minute) {
      toast.show(t('calls.availability.invalidRange'), 'error');
      return;
    }
    persist(() => setCoachAvailability(coachId, weekday, sm, win.end_minute));
  };
  const setEnd = (em: number) => {
    if (!win) return;
    if (em - MIN_WINDOW < win.start_minute) {
      toast.show(t('calls.availability.invalidRange'), 'error');
      return;
    }
    persist(() => setCoachAvailability(coachId, weekday, win.start_minute, em));
  };

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.glassBorder, paddingTop: theme.spacing.md, gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Text variant="bodyStrong" style={[textStart, { flex: 1, textTransform: 'capitalize' }]}>{dayName}</Text>
        {!on ? <Text variant="caption" muted>{t('calls.availability.off')}</Text> : null}
        <Switch
          value={on}
          onValueChange={toggle}
          disabled={busy}
          trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
          thumbColor={theme.colors.text}
        />
      </View>
      {on ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <Text variant="label" muted style={textStart}>{t('calls.availability.from')}</Text>
            <TimeField value={win!.start_minute} onChange={setStart} disabled={busy} />
          </View>
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <Text variant="label" muted style={textStart}>{t('calls.availability.to')}</Text>
            <TimeField value={win!.end_minute} onChange={setEnd} disabled={busy} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function WeeklyHoursEditor({ windows, coachId, onChanged }: { windows: CoachAvailability[]; coachId: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const byDay = new Map(windows.map((w) => [w.weekday, w]));
  return (
    <GlassCard style={{ gap: theme.spacing.sm }}>
      <View style={{ gap: 2, marginBottom: theme.spacing.xs }}>
        <Text variant="bodyStrong" style={textStart}>{t('calls.availability.weeklyTitle')}</Text>
        <Text variant="caption" muted style={textStart}>{t('calls.availability.weeklySub')}</Text>
      </View>
      {WEEKDAYS.map((wd) => (
        <DayRow key={wd} weekday={wd} win={byDay.get(wd)} coachId={coachId} onChanged={onChanged} />
      ))}
    </GlassCard>
  );
}

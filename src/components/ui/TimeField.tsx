// TimeField — a compact AM/PM time picker that works on web AND native with no native module
// (the typed `HH:MM` 24h field it replaces was the recurring complaint). The value is
// minutes-from-midnight (0–1439). Tapping the pill opens a 3-column wheel (hour · minute ·
// AM/PM) in a bottom-sheet Modal; "Done" commits. Module-scope → its OWN useTranslation.
import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { theme } from '@/theme';
import { useIsWideWeb } from '@/lib/useBreakpoint';
import { Text } from './Text';
import { Button } from './Button';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12

/** minutes-from-midnight → "9:05 AM" (am/pm localized). */
export function minutesToLabel(min: number, am: string, pm: string): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${pad(m)} ${h < 12 ? am : pm}`;
}

export type TimeFieldProps = {
  /** minutes from midnight (0–1439) */
  value: number;
  onChange: (minutes: number) => void;
  /** minute granularity in the picker (default 5) */
  minuteStep?: number;
  disabled?: boolean;
};

function Column<T extends string | number>({
  items,
  selected,
  render,
  onSelect,
}: {
  items: readonly T[];
  selected: T;
  render: (v: T) => string;
  onSelect: (v: T) => void;
}) {
  return (
    <ScrollView style={{ maxHeight: 196 }} showsVerticalScrollIndicator={false}>
      {items.map((it) => {
        const active = it === selected;
        return (
          <Pressable
            key={String(it)}
            onPress={() => onSelect(it)}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 16,
              marginVertical: 1,
              borderRadius: theme.radii.sm,
              alignItems: 'center',
              backgroundColor: active ? theme.colors.primary : 'transparent',
            }}
          >
            <Text variant="bodyStrong" color={active ? theme.colors.onPrimary : theme.colors.text}>
              {render(it)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function TimeField({ value, onChange, minuteStep = 5, disabled }: TimeFieldProps) {
  const { t } = useTranslation();
  const am = t('calls.time.am');
  const pm = t('calls.time.pm');
  const [open, setOpen] = useState(false);

  const h24 = Math.floor(value / 60);
  const [dh, setDh] = useState(((h24 + 11) % 12) + 1); // 1..12
  const [dm, setDm] = useState(value % 60);
  const [dap, setDap] = useState<'am' | 'pm'>(h24 < 12 ? 'am' : 'pm');

  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);

  const openPicker = () => {
    const h = Math.floor(value / 60);
    setDh(((h + 11) % 12) + 1);
    // Snap the minute to the picker's grid so a (legacy) off-grid value still highlights a column.
    const maxMin = (Math.ceil(60 / minuteStep) - 1) * minuteStep;
    setDm(Math.min(maxMin, Math.round((value % 60) / minuteStep) * minuteStep));
    setDap(h < 12 ? 'am' : 'pm');
    setOpen(true);
  };
  const commit = () => {
    let h = dh % 12; // 12 → 0
    if (dap === 'pm') h += 12; // 12pm → 12, 12am → 0
    onChange(h * 60 + dm);
    setOpen(false);
  };

  const wide = useIsWideWeb();

  return (
    <>
      <Pressable
        onPress={disabled ? undefined : openPicker}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.surface,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          alignItems: 'center',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text variant="bodyStrong">{minutesToLabel(value, am, pm)}</Text>
      </Pressable>

      {/* Wide web → a compact centered dialog (a full-width bottom sheet reads as broken on a
          desktop). Native / narrow web → the bottom sheet. */}
      <Modal visible={open} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            justifyContent: wide ? 'center' : 'flex-end',
            alignItems: wide ? 'center' : 'stretch',
            padding: wide ? theme.spacing.lg : 0,
            backgroundColor: 'rgba(5,6,9,0.72)',
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.glassBorder,
              gap: theme.spacing.lg,
              ...(wide
                ? { width: 360, maxWidth: '100%', borderRadius: theme.radii.xl, padding: theme.spacing.xl }
                : {
                    borderTopLeftRadius: theme.radii.xl,
                    borderTopRightRadius: theme.radii.xl,
                    paddingHorizontal: theme.spacing.lg,
                    paddingTop: theme.spacing.md,
                    paddingBottom: theme.spacing.xxl,
                  }),
            }}
          >
            {!wide ? (
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.glassBorder, alignSelf: 'center' }} />
            ) : null}
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Column items={HOURS} selected={dh} render={(h) => String(h)} onSelect={setDh} />
              </View>
              <View style={{ flex: 1 }}>
                <Column items={minutes} selected={dm} render={(m) => pad(m)} onSelect={setDm} />
              </View>
              <View style={{ flex: 1 }}>
                <Column items={['am', 'pm'] as const} selected={dap} render={(x) => (x === 'am' ? am : pm)} onSelect={setDap} />
              </View>
            </View>
            <Button title={t('common.done')} onPress={commit} fullWidth />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

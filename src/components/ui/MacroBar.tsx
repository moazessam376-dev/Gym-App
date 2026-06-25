// Protein / Carbs / Fat macro readout — brand color coding (P = Signal cyan,
// C = cobalt, F = purple). Each macro shows a mono gram value, an uppercase label,
// and an optional fill bar (consumed / target). Used on Home + Nutrition.
import { View, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';

const PURPLE = '#9B7BF5'; // brand purple (tier.master family) — the Fat series color

export type MacroBarProps = {
  protein: number;
  carbs: number;
  fat: number;
  /** Optional per-macro targets (grams) to draw the fill ratio. */
  targets?: { protein: number; carbs: number; fat: number } | null;
  /** Gram unit suffix (default "g"). */
  unit?: string;
  style?: ViewStyle;
};

export function MacroBar({ protein, carbs, fat, targets, unit = 'g', style }: MacroBarProps) {
  const rows: { key: string; label: string; value: number; target: number; color: string }[] = [
    { key: 'p', label: 'P', value: protein, target: targets?.protein ?? 0, color: theme.colors.primary },
    { key: 'c', label: 'C', value: carbs, target: targets?.carbs ?? 0, color: theme.colors.secondary },
    { key: 'f', label: 'F', value: fat, target: targets?.fat ?? 0, color: PURPLE },
  ];
  return (
    <View style={[{ flexDirection: 'row', gap: theme.spacing.md }, style]}>
      {rows.map((m) => {
        const ratio = m.target > 0 ? Math.min(1, m.value / m.target) : 0;
        return (
          <View key={m.key} style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 11, color: m.color }}>{m.label}</Text>
              <Text variant="mono" color={theme.colors.text}>
                {Math.round(m.value)}
                <Text variant="mono" color={theme.colors.textMuted} style={{ fontSize: 11 }}>
                  {unit}
                </Text>
              </Text>
            </View>
            {targets ? (
              <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.border, overflow: 'hidden' }}>
                <View style={{ width: `${ratio * 100}%`, height: 4, backgroundColor: m.color }} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// Fluid card grid — the RN-safe equivalent of CSS `grid auto-fill minmax(min,1fr)`.
// Measures its own width and lays children into N equal columns (N grows with width),
// using a negative-margin gutter so gaps stay even. Works on web AND native (no
// `display:'grid'`, which RN doesn't type and crashes off-web). One column until the
// first layout pass resolves the width.
import { Children, useState, type ReactNode } from 'react';
import { View, type DimensionValue, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { theme } from '@/theme';

export type ResponsiveGridProps = {
  children: ReactNode;
  /** Minimum width a column may shrink to before dropping one (px). */
  minColWidth?: number;
  /** Gutter between cells (px). */
  gap?: number;
  style?: ViewStyle;
};

export function ResponsiveGrid({
  children,
  minColWidth = 320,
  gap = theme.spacing.lg,
  style,
}: ResponsiveGridProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const items = Children.toArray(children);
  const cols = width > 0 ? Math.max(1, Math.floor((width + gap) / (minColWidth + gap))) : 1;
  const cellWidth: DimensionValue = cols <= 1 ? '100%' : (`${100 / cols}%` as DimensionValue);

  return (
    <View
      onLayout={onLayout}
      style={[{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }, style]}
    >
      {items.map((child, i) => (
        <View key={i} style={{ width: cellWidth, paddingHorizontal: gap / 2, marginBottom: gap }}>
          {child}
        </View>
      ))}
    </View>
  );
}

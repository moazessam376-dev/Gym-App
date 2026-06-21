import { View } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { theme } from '@/theme';

export type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showDot?: boolean;
};

/**
 * Tiny glowing line chart. Glow is faked with a thick low-opacity stroke under a
 * thin bright one (reliable across platforms without SVG filters). Used for the
 * client-progress trend on dashboard cards.
 */
export function Sparkline({
  data,
  width = 80,
  height = 32,
  color = theme.colors.primary,
  showDot = true,
}: SparklineProps) {
  if (data.length < 2) return <View style={{ width, height }} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 3;
  const stepX = (width - pad * 2) / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / range);
    return [x, y] as const;
  });
  const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ');
  const last = pts[pts.length - 1]!;

  return (
    <Svg width={width} height={height}>
      <Polyline points={polyline} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points={polyline} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {showDot ? <Circle cx={last[0]} cy={last[1]} r={3} fill={color} /> : null}
    </Svg>
  );
}

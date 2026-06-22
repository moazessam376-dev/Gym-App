import { Fragment, useState } from 'react';
import { View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { theme } from '@/theme';

export type LineChartPoint = {
  /** Plotted value (display unit, e.g. kg). */
  value: number;
  /** Short x-axis label (e.g. "Mar 3"). Only the first/last are rendered. */
  label?: string;
};

export type LineChartProps = {
  data: LineChartPoint[];
  height?: number;
  color?: string;
  /** Appended to the min/max value labels (e.g. " kg"). */
  unit?: string;
  style?: ViewStyle;
};

/**
 * Full-width trend line chart (the big sibling of Sparkline). Self-measures its
 * width via onLayout so it fills whatever card it sits in. Glow is faked with a
 * thick low-opacity stroke under a thin bright one (no SVG filters needed). Used
 * for the weight-history trend on the progress screens.
 */
export function LineChart({
  data,
  height = 180,
  color = theme.colors.primary,
  unit = '',
  style,
}: LineChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // Reserve gutters: left for y labels, bottom for x labels, top for the last value.
  const padL = 40;
  const padR = 12;
  const padT = 16;
  const padB = 22;

  const min = data.length ? Math.min(...data.map((d) => d.value)) : 0;
  const max = data.length ? Math.max(...data.map((d) => d.value)) : 0;
  const range = max - min || 1;

  const plotW = Math.max(0, width - padL - padR);
  const plotH = Math.max(0, height - padT - padB);
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;

  const pts = data.map((d, i) => {
    const x = padL + i * stepX;
    const y = padT + plotH * (1 - (d.value - min) / range);
    return [x, y] as const;
  });
  const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ');
  const last = pts[pts.length - 1];

  return (
    <View onLayout={onLayout} style={[{ height }, style]}>
      {width > 0 && data.length > 0 ? (
        <Svg width={width} height={height}>
          {/* Min / max gridlines + y labels */}
          {[max, min].map((v, idx) => {
            const y = idx === 0 ? padT : padT + plotH;
            return (
              <Fragment key={idx}>
                <Line
                  x1={padL}
                  y1={y}
                  x2={width - padR}
                  y2={y}
                  stroke={theme.colors.border}
                  strokeWidth={1}
                  strokeDasharray="3 5"
                />
                <SvgText
                  x={padL - 6}
                  y={y + 4}
                  fill={theme.colors.textMuted}
                  fontSize={10}
                  textAnchor="end"
                >
                  {`${Math.round(v * 10) / 10}${unit}`}
                </SvgText>
              </Fragment>
            );
          })}

          {data.length > 1 ? (
            <>
              {/* Glow underlay + bright line */}
              <Polyline
                points={polyline}
                fill="none"
                stroke={color}
                strokeOpacity={0.25}
                strokeWidth={7}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Polyline
                points={polyline}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : null}

          {/* Dots */}
          {pts.map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 4 : 2.5} fill={color} />
          ))}

          {/* Last value callout */}
          {last ? (
            <SvgText
              x={Math.min(last[0], width - padR)}
              y={Math.max(last[1] - 8, 11)}
              fill={theme.colors.text}
              fontSize={11}
              fontWeight="bold"
              textAnchor="end"
            >
              {`${Math.round(data[data.length - 1]!.value * 10) / 10}${unit}`}
            </SvgText>
          ) : null}

          {/* First / last x labels */}
          {data[0]?.label ? (
            <SvgText x={padL} y={height - 6} fill={theme.colors.textMuted} fontSize={10} textAnchor="start">
              {data[0].label}
            </SvgText>
          ) : null}
          {data.length > 1 && data[data.length - 1]?.label ? (
            <SvgText
              x={width - padR}
              y={height - 6}
              fill={theme.colors.textMuted}
              fontSize={10}
              textAnchor="end"
            >
              {data[data.length - 1]!.label}
            </SvgText>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

// The 8-tier rank "gem" crest — a radial-gradient jewel, tier-colored from
// theme.tier (NEVER a hardcoded tier hex). Used on the athlete home rank strip,
// the leaderboard, and the rank-up moment. This is the RANK identity; it is never
// the app icon (that's the R. monogram). The full ranking SYSTEM is a separate
// phase — this component is presentational dressing over whatever tier it's given.
import { useId } from 'react';
import Svg, { Defs, RadialGradient, Rect, Stop, G } from 'react-native-svg';
import { View, type ViewStyle } from 'react-native';
import { theme, type Tier } from '@/theme';
import { Text } from './Text';

/** Lighten (amt>0) or darken (amt<0) a #rrggbb toward white/black by |amt| (0..1). */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const mix = (c: number) => Math.round((f - c) * p + c);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export type RankCrestProps = {
  tier: Tier;
  size?: number;
  /** Optional division numeral (I / II / III) shown on the gem. */
  division?: string;
  /** Opt-in glow halo (rank-up moment / featured). Off by default (flat premium). */
  glow?: boolean;
  style?: ViewStyle;
};

export function RankCrest({ tier, size = 48, division, glow = false, style }: RankCrestProps) {
  const base = theme.tier[tier];
  const light = shade(base, 0.4);
  const dark = shade(base, -0.4);
  // UNIQUE per instance: multiple same-tier crests on one page (the leaderboard, the roster)
  // would otherwise emit duplicate SVG gradient ids, and on web `fill="url(#id)"` fails to
  // resolve against a duplicate → the gem renders gray. useId is unique + stable; strip the
  // ':' react adds (invalid in an SVG id / url() reference).
  const id = `crest-${tier}-${useId().replace(/:/g, '')}`;

  return (
    <View
      style={[
        { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        glow ? theme.glow(base, size * 0.5, 0.5) : null,
        style,
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="32%" r="72%">
            <Stop offset="0%" stopColor={light} />
            <Stop offset="55%" stopColor={base} />
            <Stop offset="100%" stopColor={dark} />
          </RadialGradient>
        </Defs>
        {/* The gem body. */}
        <Rect x="8" y="8" width="84" height="84" rx="22" fill={`url(#${id})`} />
        {/* Top highlight + a rotated inner facet for the jewel read. */}
        <Rect x="8" y="8" width="84" height="40" rx="22" fill={theme.colors.white} opacity={0.14} />
        <G transform="rotate(45 50 50)">
          <Rect x="30" y="30" width="40" height="40" rx="8" fill={theme.colors.bg} opacity={0.22} />
        </G>
      </Svg>
      {division ? (
        <Text
          variant="mono"
          color={theme.colors.white}
          style={{ position: 'absolute', fontSize: size * 0.26, fontFamily: theme.fontFamily.monoBold }}
        >
          {division}
        </Text>
      ) : null}
    </View>
  );
}

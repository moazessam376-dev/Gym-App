// The Raptor wordmark. Brand rules (non-negotiable):
//   • Geist 900 (displayBlack), never another weight, never gradient-filled.
//   • The TRAILING DOT is the ONLY Signal-cyan element — the accent never sits on a
//     letter. On a light background the dot deepens to #1A8A78 (same cyan family) for
//     contrast; the wordmark itself is never re-colored.
import { Text as RNText, type TextStyle } from 'react-native';
import { theme } from '../../theme';

const LIGHT_DOT = '#1A8A78'; // deepened Signal cyan for light backgrounds (WCAG)

export function Wordmark({
  size = 30,
  onLight = false,
  style,
}: {
  size?: number;
  /** Render on a light surface — deepens the dot and darkens the letters. */
  onLight?: boolean;
  style?: TextStyle;
}) {
  const letters = onLight ? theme.colors.bg : theme.colors.text;
  const dot = onLight ? LIGHT_DOT : theme.colors.primary;
  return (
    <RNText
      allowFontScaling={false}
      style={[
        { fontFamily: theme.fontFamily.displayBlack, fontSize: size, letterSpacing: -size * 0.04, color: letters },
        style,
      ]}
    >
      Raptor<RNText style={{ color: dot }}>.</RNText>
    </RNText>
  );
}

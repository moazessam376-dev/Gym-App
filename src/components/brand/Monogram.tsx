// The Raptor "R." monogram — the same letterform + cyan dot as the wordmark, for
// tight spaces (app icon, splash, loading, notification badge). Optionally framed in a
// rounded onyx tile (~22% corner radius, matching the app-icon spec). NEVER a rank
// crest — the gem crest is a separate, tier-colored mark and must not substitute here.
import { Text as RNText, View, type ViewStyle } from 'react-native';
import { theme } from '../../theme';

export function Monogram({
  size = 56,
  framed = false,
  style,
}: {
  /** Glyph size (or tile size when framed). */
  size?: number;
  /** Wrap the "R." in a rounded onyx tile (app-icon style). */
  framed?: boolean;
  style?: ViewStyle;
}) {
  const glyph = framed ? size * 0.52 : size;
  const mark = (
    <RNText
      allowFontScaling={false}
      style={{
        fontFamily: theme.fontFamily.displayBlack,
        fontSize: glyph,
        letterSpacing: -glyph * 0.04,
        color: theme.colors.text,
      }}
    >
      R<RNText style={{ color: theme.colors.primary }}>.</RNText>
    </RNText>
  );

  if (!framed) return mark;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size * 0.22,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {mark}
    </View>
  );
}

// Twemoji glyph renderer (Phase 18 Slice 2 polish). Renders the flat, unified
// Twemoji image for one of our fixed reaction emojis so the look is identical across
// iOS / Android / web (the device's own emoji font otherwise varies a lot). No native
// dependency — just an <Image> off the jsDelivr CDN (pinned + cached). If the image
// fails (offline), it falls back to the native emoji glyph so nothing renders blank.
import { useState } from 'react';
import { Image, Text, type StyleProp, type ImageStyle } from 'react-native';

// jdecked/twemoji asset set, pinned for stable caching. Codepoints verified against
// the CDN; ❤️ uses its FE0F-stripped form (2764), per Twemoji's naming.
const TWEMOJI_VERSION = '15.1.0';
const TWEMOJI_BASE = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TWEMOJI_VERSION}/assets/72x72/`;

const CODEPOINTS: Record<string, string> = {
  '👍': '1f44d',
  '❤️': '2764',
  '😂': '1f602',
  '🔥': '1f525',
  '💪': '1f4aa',
  '🎉': '1f389',
};

export function Emoji({
  char,
  size,
  style,
}: {
  char: string;
  size: number;
  style?: StyleProp<ImageStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const code = CODEPOINTS[char];

  // Unknown emoji or a load failure → native glyph (never blank).
  if (!code || failed) {
    return <Text style={{ fontSize: size, lineHeight: size * 1.15, includeFontPadding: false }}>{char}</Text>;
  }

  return (
    <Image
      accessibilityLabel={char}
      source={{ uri: `${TWEMOJI_BASE}${code}.png` }}
      onError={() => setFailed(true)}
      style={[{ width: size, height: size }, style]}
    />
  );
}

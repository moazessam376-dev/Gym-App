import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { theme } from '@/theme';
import type { TextVariant } from '@/theme';

type Color = keyof typeof theme.colors | (string & {});

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  color?: Color;
  align?: TextStyle['textAlign'];
  muted?: boolean;
};

/**
 * Themed text. Defaults to body Inter in primary text color. Pass `variant` for
 * display/heading scales and `color` for a token key (e.g. "primary", "danger")
 * or a raw hex.
 */
export function Text({ variant = 'body', color, muted, align, style, ...rest }: TextProps) {
  const resolved =
    color != null
      ? (theme.colors as Record<string, string>)[color] ?? color
      : muted
        ? theme.colors.textMuted
        : theme.colors.text;

  return (
    <RNText
      style={[theme.textVariants[variant], { color: resolved, textAlign: align }, style]}
      {...rest}
    />
  );
}

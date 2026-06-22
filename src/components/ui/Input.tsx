import { useState } from 'react';
import { TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';

export type InputProps = TextInputProps & {
  label?: string;
  error?: string | null;
  containerStyle?: ViewStyle;
};

/** Themed text field with optional label + error line. */
export function Input({ label, error, containerStyle, style, onFocus, onBlur, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[{ gap: theme.spacing.xs }, containerStyle]}>
      {label ? (
        <Text variant="label" muted>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={theme.colors.textMuted}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: error
              ? theme.colors.danger
              : focused
                ? theme.colors.primary
                : theme.colors.border,
            borderRadius: theme.radii.md,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            color: theme.colors.text,
            fontFamily: theme.fontFamily.bodyRegular,
            fontSize: 15,
          },
          // Cap multiline growth so newlines can't push the layout off-screen
          // (overridable by the caller's `style`). Applies app-wide.
          rest.multiline ? { minHeight: 80, maxHeight: 140, textAlignVertical: 'top' as const } : null,
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

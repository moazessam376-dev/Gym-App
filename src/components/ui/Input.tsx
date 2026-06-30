import { useEffect, useRef, useState } from 'react';
import { Platform, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';

export type InputProps = TextInputProps & {
  label?: string;
  error?: string | null;
  containerStyle?: ViewStyle;
  /** Render the value in JetBrains Mono — for numeric / code fields (weight, reps, invite code). */
  mono?: boolean;
};

/** Themed text field with optional label + error line. */
export function Input({ label, error, containerStyle, style, mono = false, onFocus, onBlur, onSubmitEditing, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);

  // Enter-to-submit, ONE mechanism per platform (never double-fires):
  //  • native → onSubmitEditing (the return/go/send key).
  //  • web → a real DOM `keydown` listener on the underlying element (RN-Web filters
  //    unknown props like onKeyDown/onKeyPress, so we attach it via the ref). Single-line
  //    only; Shift+Enter never submits. submitRef keeps the latest handler (no stale closure).
  const inputRef = useRef<TextInput | null>(null);
  const submitRef = useRef(onSubmitEditing);
  submitRef.current = onSubmitEditing;
  useEffect(() => {
    if (Platform.OS !== 'web' || rest.multiline) return;
    const node = inputRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitRef.current?.({ nativeEvent: { text: '' } } as never);
      }
    };
    node.addEventListener('keydown', handler);
    return () => node.removeEventListener('keydown', handler);
  }, [rest.multiline]);

  return (
    <View style={[{ gap: theme.spacing.xs }, containerStyle]}>
      {label ? (
        <Text variant="label" muted>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={inputRef}
        placeholderTextColor={theme.colors.textMuted}
        // Keyboard correction ON by default (overridable per-field: email/token/
        // password fields pass autoCapitalize="none"/autoCorrect={false}, which win
        // because {...rest} is spread after these).
        autoCapitalize="sentences"
        autoCorrect
        spellCheck
        onSubmitEditing={Platform.OS === 'web' ? undefined : onSubmitEditing}
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
            fontFamily: mono ? theme.fontFamily.monoRegular : theme.fontFamily.bodyRegular,
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

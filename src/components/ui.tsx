// Minimal shared UI primitives so screens stay declarative.
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

export function Screen({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 12 }}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 22, fontWeight: '700' }}>{children}</Text>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <Text style={{ opacity: 0.7 }}>{children}</Text>;
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return <Text style={{ color: '#dc2626' }}>{children}</Text>;
}

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor="#9ca3af"
      style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, fontSize: 16 }}
      {...props}
    />
  );
}

export function Button({
  label,
  onPress,
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={{
        backgroundColor: off ? '#9ca3af' : '#2563eb',
        padding: 14,
        borderRadius: 10,
        alignItems: 'center',
      }}
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text style={{ color: '#ffffff', fontWeight: '600' }}>{label}</Text>
      )}
    </Pressable>
  );
}

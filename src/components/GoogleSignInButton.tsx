// "Continue with Google" button + an "or" divider, shared by sign-in and sign-up
// (Phase 14d launch auth). Self-contained: it runs the OAuth flow and reports a
// generic failure through onError; a user cancel is silent. Styled as a neutral
// secondary action so the email primary button stays the main path.
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { signInWithGoogle } from '../lib/oauth';
import { GoogleMark } from './brand';
import { Text } from './ui';
import { theme } from '../theme';

export function GoogleSignInButton({
  onError,
  disabled,
}: {
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  async function onPress() {
    setLoading(true);
    try {
      const res = await signInWithGoogle();
      // ok → AuthProvider's onAuthStateChange routes into the app; cancel → silent.
      if (!res.ok && !res.cancelled) onError?.('Could not sign in with Google. Please try again.');
    } catch {
      onError?.('Could not sign in with Google. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
        <Text variant="caption" muted>
          or
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
      </View>

      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.sm,
          height: 52,
          borderRadius: theme.radii.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          opacity: disabled || loading ? 0.6 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator color={theme.colors.text} />
        ) : (
          <>
            <GoogleMark size={20} />
            <Text variant="bodyStrong">Continue with Google</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

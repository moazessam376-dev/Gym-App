// Edit your profile (display name). Any role. The name isn't in the JWT, so no
// re-login is needed — it reflects on the next data load (roster, coach card).
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../src/lib/auth-context';
import { getMyName, updateMyName } from '../src/lib/profile';
import { readCache, writeCache } from '../src/lib/screen-cache';
import { Screen, Text, Input, Button } from '../src/components/ui';
import { theme } from '../src/theme';

export default function Profile() {
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;
  const cacheKey = userId ? `profile-name:${userId}` : null;

  // Seed from the warm cache so the form shows instantly (no loading spinner);
  // the focus refetch updates it silently.
  const [name, setName] = useState(readCache<string>(cacheKey) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const n = (await getMyName(userId)) ?? '';
      setName(n);
      writeCache(cacheKey, n);
    } catch {
      /* leave blank */
    }
  }, [userId, cacheKey]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onSave() {
    setError(null);
    setSaved(false);
    if (name.trim().length < 1) {
      setError('Enter your name.');
      return;
    }
    if (!userId) {
      setError('Your session expired. Sign in again.');
      return;
    }
    setSaving(true);
    try {
      await updateMyName(userId, name);
      writeCache(cacheKey, name.trim());
      setSaved(true);
    } catch {
      setError('Could not save your name. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.md }}>
          <Input
            label="Display name"
            value={name}
            onChangeText={(t) => {
              setName(t);
              setSaved(false);
            }}
            placeholder="Your name"
            autoCapitalize="words"
            editable={!saving}
            error={error}
          />
          {session?.user?.email ? (
            <Text variant="caption" muted>
              {session.user.email}
            </Text>
          ) : null}
          {saved ? (
            <Text variant="bodyStrong" color="success">
              Saved
            </Text>
          ) : null}

          <Button title="Save" onPress={onSave} loading={saving} size="lg" style={{ marginTop: theme.spacing.sm }} />
          <Button title="Done" variant="ghost" onPress={() => router.back()} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

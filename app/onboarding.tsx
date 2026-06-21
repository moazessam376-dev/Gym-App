import { View } from 'react-native';
import { supabase } from '../src/lib/supabase';
import { Screen, Text, Button } from '../src/components/ui';
import { theme } from '../src/theme';

// Reached only if a signed-in user's token has no role (rare — every signup is
// bootstrapped as 'client'). A safe holding screen; signing out re-mints a token.
export default function Onboarding() {
  return (
    <Screen gradient>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md }}>
        <Text variant="h1" align="center">
          Finishing setup…
        </Text>
        <Text variant="body" muted align="center">
          We&apos;re getting your account ready. If this doesn&apos;t move along in a moment, sign out and back in.
        </Text>
        <Button
          title="Sign out"
          variant="secondary"
          fullWidth={false}
          onPress={() => supabase.auth.signOut()}
          style={{ marginTop: theme.spacing.md }}
        />
      </View>
    </Screen>
  );
}

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../src/lib/supabase';
import { Screen, Text, Button } from '../src/components/ui';
import { Monogram } from '../src/components/brand';
import { theme } from '../src/theme';

// Reached only if a signed-in user's token has no role (rare — every signup is
// bootstrapped as 'client'). A safe holding screen; signing out re-mints a token.
export default function Onboarding() {
  const { t } = useTranslation();
  return (
    <Screen gradient>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md }}>
        <Monogram size={72} framed style={{ marginBottom: theme.spacing.sm }} />
        <Text variant="h1" align="center">
          {t('onboarding.finishing')}
        </Text>
        <Text variant="body" muted align="center">
          {t('onboarding.finishingBody')}
        </Text>
        <Button
          title={t('common.signOut')}
          variant="secondary"
          fullWidth={false}
          onPress={() => supabase.auth.signOut()}
          style={{ marginTop: theme.spacing.md }}
        />
      </View>
    </Screen>
  );
}

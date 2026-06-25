// Admin console home. Lean — the main job is reviewing coach applications.
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon, Screen, Text, Card } from '@/components/ui';
import { theme } from '@/theme';

export default function AdminHome() {
  const router = useRouter();
  return (
    <Screen scroll contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
      <View>
        <Text variant="caption" muted>
          Admin console
        </Text>
        <Text variant="h1">Platform</Text>
      </View>

      <Card onPress={() => router.push('/admin/applications')} elevated>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.surfaceElevated,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="clipboard" size={22} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="title">Coach applications</Text>
            <Text variant="caption" muted>
              Review and approve coach requests
            </Text>
          </View>
          <Icon name="chevron-forward" size={20} color={theme.colors.textMuted} />
        </View>
      </Card>
    </Screen>
  );
}

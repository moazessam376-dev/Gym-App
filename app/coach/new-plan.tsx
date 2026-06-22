// Coach → start a new plan. Clone a ready-made SYSTEM TEMPLATE (pre-filled,
// editable) or start blank. Either way the coach lands in the editor with a
// coach-owned, editable template to later assign to a client.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { cloneTemplate, createTemplate, createWeek, listSystemTemplates, type Plan } from '../../src/lib/plans';
import { planTypeSchema, type PlanType } from '../../src/schemas/plan';
import { Screen, Text, Input, Button, GlassCard, Segmented } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function NewPlan() {
  const { role, session } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const initial = planTypeSchema.safeParse(params.type).success ? (params.type as PlanType) : 'training';

  const [type, setType] = useState<PlanType>(initial);
  const [title, setTitle] = useState('');
  const [templates, setTemplates] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTemplates(await listSystemTemplates(type));
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [type]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'coach') return <Redirect href="/" />;

  async function startBlank() {
    if (!session?.user?.id || busy) return;
    setBusy(true);
    try {
      const t = title.trim() || (type === 'training' ? 'New training plan' : 'New nutrition plan');
      const created = await createTemplate(session.user.id, { type, title: t });
      if (type === 'training') await createWeek({ plan_id: created.id, name: 'Week 1', position: 0 });
      router.replace({ pathname: '/coach/plan/[id]', params: { id: created.id } });
    } catch {
      Alert.alert('Error', 'Could not create the plan. Please try again.');
      setBusy(false);
    }
  }

  async function startFromTemplate(t: Plan) {
    if (busy) return;
    setBusy(true);
    try {
      const newId = await cloneTemplate(t.id);
      router.replace({ pathname: '/coach/plan/[id]', params: { id: newId } });
    } catch {
      Alert.alert('Error', 'Could not start from that template. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={loading ? [] : templates}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: theme.spacing.md }}>
              <Segmented
                value={type}
                onChange={setType}
                options={[
                  { value: 'training', label: 'Training' },
                  { value: 'nutrition', label: 'Nutrition' },
                ]}
              />
              <Text variant="label" muted style={{ marginTop: theme.spacing.sm }}>
                Start blank
              </Text>
              <Input
                value={title}
                onChangeText={setTitle}
                placeholder={type === 'training' ? 'Plan name (e.g. PPL Hypertrophy)' : 'Plan name (e.g. Lean Cut)'}
                editable={!busy}
              />
              <Button title={`Start blank ${type} plan`} variant="secondary" onPress={startBlank} disabled={busy} />
              <Text variant="label" muted style={{ marginTop: theme.spacing.sm }}>
                Or start from a template
              </Text>
              {loading ? <ActivityIndicator style={{ marginTop: 16 }} color={theme.colors.primary} /> : null}
            </View>
          }
          ListEmptyComponent={
            loading ? null : (
              <Text variant="body" muted>
                No {type} templates yet — start blank above.
              </Text>
            )
          }
          renderItem={({ item }) => (
            <GlassCard onPress={() => startFromTemplate(item)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{item.title}</Text>
                  {item.note ? (
                    <Text variant="caption" muted numberOfLines={2}>
                      {item.note}
                    </Text>
                  ) : null}
                </View>
                <Text variant="bodyStrong" color="primary">
                  Use ›
                </Text>
              </View>
            </GlassCard>
          )}
        />
        {busy ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: theme.colors.overlay, alignItems: 'center', justifyContent: 'center' },
            ]}
          >
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

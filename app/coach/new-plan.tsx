// Coach → start a new plan. Clone a ready-made SYSTEM TEMPLATE (pre-filled,
// editable) or start blank. Either way the coach lands in the editor with a
// coach-owned, editable template to later assign to a client.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { textStart } from '../../src/lib/rtl';
import { cloneTemplate, createTemplate, createWeek, listSystemTemplates, type Plan } from '../../src/lib/plans';
import { planTypeSchema, type PlanType } from '../../src/schemas/plan';
import { Screen, Text, Input, Button, GlassCard, Segmented } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function NewPlan() {
  const { t } = useTranslation();
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
      const name =
        title.trim() || (type === 'training' ? t('newPlan.defaultTrainingTitle') : t('newPlan.defaultNutritionTitle'));
      const created = await createTemplate(session.user.id, { type, title: name });
      if (type === 'training') await createWeek({ plan_id: created.id, name: 'Week 1', position: 0 });
      // fresh=1 → the editor treats it as uncommitted until "Save to my plans".
      router.replace({ pathname: '/coach/plan/[id]', params: { id: created.id, fresh: '1' } });
    } catch {
      Alert.alert(t('common.errorTitle'), t('newPlan.createError'));
      setBusy(false);
    }
  }

  async function startFromTemplate(tpl: Plan) {
    if (busy) return;
    setBusy(true);
    try {
      const newId = await cloneTemplate(tpl.id);
      // fresh=1 → the editor treats it as uncommitted until "Save to my plans".
      router.replace({ pathname: '/coach/plan/[id]', params: { id: newId, fresh: '1' } });
    } catch {
      Alert.alert(t('common.errorTitle'), t('newPlan.templateError'));
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
                  { value: 'training', label: t('common.training') },
                  { value: 'nutrition', label: t('common.nutrition') },
                ]}
              />
              <Text variant="label" muted style={[{ marginTop: theme.spacing.sm }, textStart]}>
                {t('newPlan.startBlank')}
              </Text>
              <Input
                value={title}
                onChangeText={setTitle}
                placeholder={
                  type === 'training' ? t('newPlan.titlePlaceholderTraining') : t('newPlan.titlePlaceholderNutrition')
                }
                editable={!busy}
              />
              <Button
                title={t('newPlan.startBlankBtn', { type: t(`common.${type}`) })}
                variant="secondary"
                onPress={startBlank}
                disabled={busy}
              />
              <Text variant="label" muted style={[{ marginTop: theme.spacing.sm }, textStart]}>
                {t('newPlan.orFromTemplate')}
              </Text>
              {loading ? <ActivityIndicator style={{ marginTop: 16 }} color={theme.colors.primary} /> : null}
            </View>
          }
          ListEmptyComponent={
            loading ? null : (
              <Text variant="body" muted style={textStart}>
                {t('newPlan.noTemplates', { type: t(`common.${type}`) })}
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
                  {t('newPlan.use')}
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

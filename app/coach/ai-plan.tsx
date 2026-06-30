// Coach → Generate an AI plan. SELF-CONTAINED: pick a client, then write an optional
// prompt and Generate right here — it calls generatePlan and opens the new plan in the
// editor. No hand-off to the client-detail modal (that path silently failed: the modal's
// open-state was read once via useState, and the desktop client view has no modal). Works
// identically on mobile + web. Reached from new-plan's "Generate with AI".
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { forwardChevron, textStart } from '../../src/lib/rtl';
import { listMyClients, type Client } from '../../src/lib/invitations';
import { generatePlan } from '../../src/lib/coach-ai';
import { planTypeSchema, type PlanType } from '../../src/schemas/plan';
import { Icon, Screen, Text, Avatar, GlassCard, EmptyState, Input, Button, Chip, useToast } from '../../src/components/ui';
import { theme } from '../../src/theme';

const PROMPT_CHIP_KEYS: Record<PlanType, string[]> = {
  training: ['ppl', 'ul', 'fullBody', 'kneeFriendly', 'minimalEquipment', 'progressiveOverload', 'includeCore'],
  nutrition: ['highProtein', 'budget', 'quick', 'moreVeg', 'lowCarb', 'vegetarian'],
};

/** Append a chip phrase to the prompt (comma-separated), avoiding duplicates. */
function appendChip(prev: string, phrase: string): string {
  const parts = prev.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === phrase.toLowerCase())) return prev;
  return [...parts, phrase].join(', ');
}

export default function AiPlanGenerator() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ type?: string }>();
  const type: PlanType = planTypeSchema.safeParse(params.type).success ? (params.type as PlanType) : 'training';

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Client | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClients(await listMyClients());
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'coach') return <Redirect href="/" />;

  const labelOf = (c: Client) => c.full_name ?? c.invited_email ?? t('home.client');

  async function onGenerate() {
    if (!selected || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await generatePlan({ clientId: selected.id, type, coachPrompt: prompt.trim() || undefined });
      if (res.status === 'generated' && res.plan_id) {
        toast.show(t('aiPlan.generated'), 'success');
        // Replace so Back returns to new-plan, not this picker mid-flow.
        router.replace({ pathname: '/coach/plan/[id]', params: { id: res.plan_id } });
      } else if (res.status === 'no_profile') {
        setMsg(t('clientDetail.profileNeededBody'));
      } else if (res.status === 'rate_limited') {
        setMsg(t('clientDetail.planLimitBody'));
      } else {
        setMsg(t('clientDetail.genFailBody'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  // STEP 2 — a client is chosen: write a prompt and generate.
  if (selected) {
    return (
      <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
        <GlassCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Avatar name={labelOf(selected)} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" color="primary" style={textStart}>
                {t('aiPlan.generateFor')}
              </Text>
              <Text variant="title" style={textStart} numberOfLines={1}>
                {labelOf(selected)}
              </Text>
            </View>
            <Button
              title={t('aiPlan.changeClient')}
              variant="ghost"
              fullWidth={false}
              onPress={() => {
                setSelected(null);
                setPrompt('');
                setMsg(null);
              }}
              disabled={busy}
            />
          </View>
        </GlassCard>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('aiPlan.promptLabel')}
          </Text>
          <Input
            value={prompt}
            onChangeText={setPrompt}
            placeholder={t('clientDetail.aiPromptPlaceholder')}
            editable={!busy}
            multiline
            style={{ minHeight: 72, textAlignVertical: 'top' }}
          />
          {/* Quick-add chips — append proven phrases for higher-quality output. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {PROMPT_CHIP_KEYS[type].map((k) => {
              const phrase = t(`clientDetail.chips.${k}`);
              return <Chip key={k} label={`+ ${phrase}`} onPress={() => setPrompt((p) => appendChip(p, phrase))} />;
            })}
          </View>
          <Text variant="label" muted style={[{ fontSize: 10 }, textStart]}>
            {type === 'training' ? t('clientDetail.trainingNote') : t('clientDetail.nutritionNote')}
          </Text>
        </View>

        {msg ? (
          <Text variant="caption" color={theme.colors.warning} style={textStart}>
            {msg}
          </Text>
        ) : null}

        <Button title={t('clientDetail.generate')} onPress={onGenerate} loading={busy} />
      </Screen>
    );
  }

  // STEP 1 — pick a client.
  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <FlatList
        data={clients}
        keyExtractor={(c) => c.id}
        contentContainerStyle={
          clients.length === 0
            ? { flexGrow: 1, justifyContent: 'center' }
            : { padding: theme.spacing.lg, gap: theme.spacing.md }
        }
        ListHeaderComponent={
          clients.length === 0 ? null : (
            <Text variant="body" muted style={[{ marginBottom: theme.spacing.xs }, textStart]}>
              {t('aiPlan.intro')}
            </Text>
          )
        }
        ListEmptyComponent={
          <EmptyState icon="people-outline" title={t('aiPlan.noClientsTitle')} subtitle={t('aiPlan.noClientsSub')} />
        }
        renderItem={({ item }) => (
          <GlassCard onPress={() => { setSelected(item); setMsg(null); }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Avatar name={labelOf(item)} size={40} />
              <Text variant="title" style={{ flex: 1 }} numberOfLines={1}>
                {labelOf(item)}
              </Text>
              <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
            </View>
          </GlassCard>
        )}
      />
    </Screen>
  );
}

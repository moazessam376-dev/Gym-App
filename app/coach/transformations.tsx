// Transformation Manager (0087, "Transformation Manager" mockup) — the coach curates
// MULTIPLE before/after cards per consenting client. KPI tiles, a Pending|Published split,
// per-client card timelines (tap a thumb to edit, dashed tile to add), and a "feature a new
// client" chip row. Pending client submissions are approved (featured) or dismissed here.
// On wide web + coach this route renders the desktop portal view instead (same hooks).
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { textStart } from '../../src/lib/rtl';
import { useChrome } from '../../src/lib/chrome';
import { ProfileAvatar } from '../../src/components/ProfileAvatar';
import { Icon, Screen, Text, GlassCard, KpiTile, Segmented, EmptyState } from '../../src/components/ui';
import { TransformationEditor } from '../../src/components/transformations/TransformationEditor';
import { useTransformationManager } from '../../src/components/transformations/useTransformationManager';
import { PendingSubmissionCard, CardThumb, AddCardTile, FeatureClientChip } from '../../src/components/transformations/ManagerParts';
import { TransformationsDesktop } from '../../src/components/coach/web/TransformationsDesktop';
import { theme } from '../../src/theme';

export default function CoachTransformationsManager() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const { active: chromeActive } = useChrome();
  const m = useTransformationManager();

  if (role && role !== 'coach') return <Redirect href="/" />;
  // Desktop portal variant — AFTER all hooks (web.md rules-of-hooks).
  if (chromeActive) return <TransformationsDesktop />;

  // ── Editing / creating a card ──────────────────────────────────────────────────
  if (m.editor) {
    return (
      <Screen gradient padded={false} edges={['bottom']}>
        <Stack.Screen options={{ title: t('coachProfile.manageTransformations') }} />
        {/* automaticallyAdjustKeyboardInsets: keep the focused input (esp. the caption at the
            bottom of the form) visible above the iOS keyboard. */}
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Pressable onPress={m.closeEditor} hitSlop={8}><Icon name="chevron-back" size={22} color={theme.colors.text} /></Pressable>
            <Text variant="bodyStrong" style={[{ flex: 1 }, textStart]}>{m.editor.clientFirstName ?? ''}</Text>
            {m.editor.id ? (
              <Pressable onPress={m.onDeleteCurrent} hitSlop={8}>
                <Text variant="caption" color={theme.colors.danger}>{t('transformationManager.deleteCard')}</Text>
              </Pressable>
            ) : null}
          </View>
          <TransformationEditor
            mode="coach"
            clientId={m.editor.clientId}
            clientFirstName={m.editor.clientFirstName}
            coachName={m.coachName}
            initial={m.editor.initial}
            onSave={m.onSave}
            saveLabel={t('common.save')}
          />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <Stack.Screen options={{ title: t('coachProfile.manageTransformations') }} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text variant="body" muted style={textStart}>{t('coachProfile.transformationsHelp')}</Text>

        {/* KPI tiles — real query counts only (no fabricated stats). */}
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <KpiTile value={m.raw.length} label={t('transformationManager.kpiPublished')} tone="neutral" />
          <KpiTile value={m.pending.length} label={t('transformationManager.kpiPending')} tone="warning" />
          <KpiTile value={m.clients.length} label={t('transformationManager.kpiConsenting')} tone="neutral" />
        </View>

        <Segmented
          options={[
            { value: 'pending', label: t('transformationManager.tabPending') },
            { value: 'published', label: t('transformationManager.tabPublished') },
          ]}
          value={m.tab}
          onChange={(v) => m.setTab(v as 'pending' | 'published')}
        />

        {/* ── Pending tab ── */}
        {m.tab === 'pending' ? (
          m.pending.length === 0 ? (
            <EmptyState icon="check-circle" title={t('transformationManager.pendingEmptyTitle')} subtitle={t('transformationManager.pendingEmptySub')} />
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              {m.pending.map((sub) => (
                <PendingSubmissionCard
                  key={sub.id}
                  sub={sub}
                  busy={m.resolving === sub.id}
                  disabled={m.resolving != null}
                  onApprove={m.onResolve(sub.id, 'approve')}
                  onDismiss={m.onResolve(sub.id, 'dismiss')}
                />
              ))}
            </View>
          )
        ) : null}

        {/* ── Published tab: per-client timelines + feature-a-new-client chips ── */}
        {m.tab === 'published' ? (
          <View style={{ gap: theme.spacing.lg }}>
            {m.loading ? <ActivityIndicator color={theme.colors.primary} /> : null}
            {!m.loading && m.timelines.length === 0 ? (
              <EmptyState icon="sparkles" title={t('transformationManager.noCardsTitle')} subtitle={t('transformationManager.noCardsSub')} />
            ) : null}

            {m.timelines.map((g) => (
              <GlassCard key={g.clientId} style={{ gap: theme.spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <ProfileAvatar name={g.clientName} avatarMediaId={g.avatarMediaId} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" style={textStart}>{g.clientName ?? ''}</Text>
                    <Text style={[{ fontFamily: theme.fontFamily.monoRegular, fontSize: 11, color: theme.colors.textMuted }, textStart]}>
                      {t('transformationManager.cardCount', { count: g.rows.length })}
                    </Text>
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.md }}>
                  {g.rows.map((row) => (
                    <CardThumb key={row.id} row={row} card={m.cardById.get(row.id)} width={150} onPress={() => m.openEdit(row)} />
                  ))}
                  <AddCardTile width={110} minHeight={120} onPress={() => m.openNew(g.clientId, g.clientName?.split(' ')[0] ?? null)} />
                </ScrollView>
              </GlassCard>
            ))}

            {/* Feature a new client — non-consenting clients show an ASK chip, not hidden. */}
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="label" muted style={textStart}>{t('coachProfile.addTransformation')}</Text>
              {m.featureCandidates.length === 0 ? (
                m.timelines.length > 0 ? (
                  <Text variant="caption" muted style={textStart}>{t('transformationManager.allClientsFeatured')}</Text>
                ) : (
                  <EmptyState icon="people-outline" title={t('coachProfile.noConsentingClients')} subtitle={t('coachProfile.noConsentingClientsSub')} />
                )
              ) : (
                <GlassCard style={{ gap: theme.spacing.md }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                    {m.featureCandidates.map((c) => (
                      <FeatureClientChip
                        key={c.user_id}
                        candidate={c}
                        onOpen={() => m.openNew(c.user_id, c.full_name?.split(' ')[0] ?? null)}
                        onAsk={() => void m.onAsk(c.user_id)}
                      />
                    ))}
                  </View>
                  <Text variant="caption" muted style={textStart}>{t('transformationManager.consentHint')}</Text>
                </GlassCard>
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

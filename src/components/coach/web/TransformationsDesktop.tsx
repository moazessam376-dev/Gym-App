// TransformationsDesktop — the wide-web portal view of the Transformation Manager (0087,
// "Transformation Manager" mockup). LIST: kicker back to Public profile + KPI row +
// Pending|Published tabs (pending = a responsive grid of submission cards; published =
// per-client timelines with add tiles + the feature-a-new-client chips). EDITOR: two
// columns — the shared TransformationEditor form (preview externalized) on the left and
// the live branded card + ratio + Save photo on the right rail. Rendered ONLY in the
// coach web shell (coach/transformations.tsx returns this when useChrome().active); the
// SAME hooks + editor + card as mobile — no forked logic.
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { theme } from '@/theme';
import { textStart, forwardChevron } from '@/lib/rtl';
import type { CoachTransformation } from '@/lib/public-profiles';
import type { ConsentingClient } from '@/lib/coach-transformations';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Button, EmptyState, GlassCard, Icon, KpiTile, Screen, Segmented, Text } from '@/components/ui';
import { ShareableTransformationCard } from '@/components/ShareableTransformationCard';
import { TransformationEditor } from '@/components/transformations/TransformationEditor';
import { useTransformationManager } from '@/components/transformations/useTransformationManager';
import { PendingSubmissionCard, CardThumb, AddCardTile } from '@/components/transformations/ManagerParts';
import { ResponsiveGrid } from '@/components/ui/ResponsiveGrid';

export function TransformationsDesktop() {
  const { t } = useTranslation();
  const router = useRouter();
  const m = useTransformationManager();
  const [preview, setPreview] = useState<CoachTransformation | null>(null);

  // ── Editor view: form left, live card right ────────────────────────────────────
  if (m.editor) {
    return (
      <Screen scroll gradient contentStyle={{ padding: theme.spacing.xl, gap: theme.spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Pressable
            onPress={m.closeEditor}
            style={{ width: 34, height: 34, borderRadius: theme.radii.sm, backgroundColor: theme.colors.surfaceElevated, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="chevron-back" size={16} color={theme.colors.text} />
          </Pressable>
          <Text variant="h2" style={[{ flex: 1 }, textStart]}>{m.editor.clientFirstName ?? ''}</Text>
          {m.editor.id ? (
            <Button title={t('transformationManager.deleteCard')} variant="ghost" onPress={m.onDeleteCurrent} />
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: theme.spacing.xl, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 380 }}>
            <TransformationEditor
              mode="coach"
              clientId={m.editor.clientId}
              clientFirstName={m.editor.clientFirstName}
              coachName={m.coachName}
              initial={m.editor.initial}
              onSave={m.onSave}
              saveLabel={t('transformationManager.saveCard')}
              previewMode="external"
              onPreviewItem={setPreview}
            />
          </View>
          <View style={{ width: 300, gap: theme.spacing.sm }}>
            <Text variant="label" muted style={textStart}>{t('transformationEditor.preview')}</Text>
            {preview ? <ShareableTransformationCard item={preview} coachName={m.coachName} /> : null}
          </View>
        </View>
      </Screen>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────────
  return (
    <Screen scroll gradient contentStyle={{ padding: theme.spacing.xl, gap: theme.spacing.xl }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Pressable
          onPress={() => router.navigate('/public-profile-edit')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', opacity: 0.7 }}
        >
          {/* back = the OPPOSITE of the drill-in direction */}
          <Icon name={forwardChevron() === 'chevron-forward' ? 'chevron-back' : 'chevron-forward'} size={13} color={theme.colors.textMuted} />
          <Text variant="caption" muted>{t('webnav.profile')}</Text>
        </Pressable>
        <Text variant="h1" style={textStart}>{t('coachProfile.manageTransformations')}</Text>
        <Text variant="caption" muted style={[textStart, { maxWidth: 680 }]}>{t('coachProfile.transformationsHelp')}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.md, maxWidth: 640 }}>
        <KpiTile value={m.raw.length} label={t('transformationManager.kpiPublished')} tone="neutral" icon="sparkles" />
        <KpiTile value={m.pending.length} label={t('transformationManager.kpiPending')} tone="warning" icon="hourglass" />
        <KpiTile value={m.clients.length} label={t('transformationManager.kpiConsenting')} tone="neutral" icon="users" />
      </View>

      <View style={{ maxWidth: 420 }}>
        <Segmented
          options={[
            { value: 'pending', label: t('transformationManager.tabPending') },
            { value: 'published', label: t('transformationManager.tabPublished') },
          ]}
          value={m.tab}
          onChange={(v) => m.setTab(v as 'pending' | 'published')}
        />
      </View>

      {m.tab === 'pending' ? (
        m.pending.length === 0 ? (
          <EmptyState icon="check-circle" title={t('transformationManager.pendingEmptyTitle')} subtitle={t('transformationManager.pendingEmptySub')} />
        ) : (
          <ResponsiveGrid minColWidth={320}>
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
          </ResponsiveGrid>
        )
      ) : null}

      {m.tab === 'published' ? (
        <View style={{ gap: theme.spacing.xl }}>
          {m.loading ? <ActivityIndicator color={theme.colors.primary} /> : null}
          {!m.loading && m.timelines.length === 0 ? (
            <EmptyState icon="sparkles" title={t('transformationManager.noCardsTitle')} subtitle={t('transformationManager.noCardsSub')} />
          ) : null}

          {m.timelines.map((g) => (
            <GlassCard key={g.clientId} style={{ gap: theme.spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <ProfileAvatar name={g.clientName} avatarMediaId={g.avatarMediaId} size={36} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" style={textStart}>{g.clientName ?? ''}</Text>
                  <Text style={[{ fontFamily: theme.fontFamily.monoRegular, fontSize: 11, color: theme.colors.textMuted }, textStart]}>
                    {t('transformationManager.cardCount', { count: g.rows.length })}
                  </Text>
                </View>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: 4 }}>
                {g.rows.map((row) => (
                  <CardThumb key={row.id} row={row} card={m.cardById.get(row.id)} width={190} onPress={() => m.openEdit(row)} />
                ))}
                <AddCardTile width={190} minHeight={150} onPress={() => m.openNew(g.clientId, g.clientName?.split(' ')[0] ?? null)} />
              </ScrollView>
            </GlassCard>
          ))}

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" muted style={textStart}>{t('coachProfile.addTransformation')}</Text>
            {m.clients.length === 0 ? (
              <EmptyState icon="people-outline" title={t('coachProfile.noConsentingClients')} subtitle={t('coachProfile.noConsentingClientsSub')} />
            ) : m.clientsWithoutCards.length === 0 ? (
              <Text variant="caption" muted style={textStart}>{t('transformationManager.allClientsFeatured')}</Text>
            ) : (
              <GlassCard style={{ gap: theme.spacing.md }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                  {m.clientsWithoutCards.map((c: ConsentingClient) => (
                    <Pressable
                      key={c.user_id}
                      onPress={() => m.openNew(c.user_id, c.full_name?.split(' ')[0] ?? null)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingStart: 6, paddingEnd: theme.spacing.md, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.glassBorder, backgroundColor: theme.colors.surfaceElevated }}
                    >
                      <ProfileAvatar name={c.full_name} avatarMediaId={c.avatar_media_id} size={24} />
                      <Text variant="caption">{c.full_name ?? ''}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text variant="caption" muted style={textStart}>{t('transformationManager.consentHint')}</Text>
              </GlassCard>
            )}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

// Account hub tab — identity + role-specific actions + sign out. Replaces the
// account bits of the old launcher home (edit profile, become-coach, invite).
import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/lib/auth-context';
import { forwardChevron } from '../../src/lib/rtl';
import { useMyName, useMyCoach, useRefreshOnFocus } from '../../src/lib/queries/home';
import { deleteAccount } from '../../src/lib/account';
import { confirmDestructive } from '../../src/lib/confirm';
import { Screen, Text, Card, Avatar, Badge, Button } from '../../src/components/ui';
import { LanguageSwitcher } from '../../src/components/LanguageSwitcher';
import { theme } from '../../src/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function LinkRow({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={theme.colors.primary} />
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        {label}
      </Text>
      <Ionicons name={forwardChevron()} size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
}

export default function AccountTab() {
  const { t } = useTranslation();
  const { session, role } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  // Same cached ['my-name'] / ['my-coach'] reads as Home, so the gradient avatar
  // shows "CM" immediately on first visit instead of resolving "C" → "CM".
  const nameQ = useMyName(userId);
  const coachQ = useMyCoach(role === 'client' ? userId : undefined);
  useRefreshOnFocus(() => {
    nameQ.refetch();
    if (role === 'client') coachQ.refetch();
  });

  const name = nameQ.data ?? null;
  // Default to "has coach" until known, so the "Accept an invite" row doesn't flash in.
  const hasCoach = role !== 'client' || !coachQ.isSuccess || coachQ.data != null;
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const go = (href: Href) => () => router.push(href);

  async function onDeleteAccount() {
    // Double-confirm — irreversible erasure (PDPL). No "type DELETE" modal exists, so
    // two explicit confirms guard against an accidental tap.
    const first = await confirmDestructive(
      t('account.deleteAccount'),
      'This permanently erases your account and all your data — workouts, nutrition, progress, photos and messages. This cannot be undone.',
      t('account.deleteAccount'),
    );
    if (!first) return;
    const second = await confirmDestructive(
      t('account.deleteAccount'),
      'Are you absolutely sure? There is no way to recover your account after this.',
      t('account.deleteAccount'),
    );
    if (!second) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteAccount();
      // deleteAccount signs out → the root guard routes to sign-in.
    } catch {
      setDeleting(false);
      setDeleteError(t('account.deleteFailed'));
    }
  }

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
      <Text variant="h1">{t('account.title')}</Text>

      <Card style={{ alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xl }}>
        <Avatar name={name ?? session?.user?.email ?? '?'} size={84} />
        <Text variant="h2">{name ?? t('account.setYourName')}</Text>
        {session?.user?.email ? (
          <Text variant="caption" muted>
            {session.user.email}
          </Text>
        ) : null}
        {role ? <Badge label={role} tone="secondary" solid /> : null}
      </Card>

      <View style={{ gap: theme.spacing.sm }}>
        <LinkRow icon="person-outline" label={t('account.editProfile')} onPress={go('/profile')} />
        <LinkRow
          icon="notifications-outline"
          label={t('account.notifications')}
          onPress={go('/notification-settings')}
        />
        <LinkRow
          icon={role === 'coach' ? 'ribbon-outline' : 'flag-outline'}
          label={role === 'coach' ? t('account.coachingProfile') : t('account.goalsProfile')}
          onPress={go('/profile-setup')}
        />

        {role === 'client' ? (
          <>
            <LinkRow icon="heart-outline" label={t('account.foodPreferences')} onPress={go('/food/preferences')} />
            {!hasCoach ? (
              <LinkRow icon="ticket-outline" label={t('account.acceptInvite')} onPress={go('/accept-invite')} />
            ) : null}
            <LinkRow icon="ribbon-outline" label={t('account.becomeCoach')} onPress={go('/become-coach')} />
          </>
        ) : null}

        {role === 'coach' ? (
          <>
            <LinkRow icon="person-add-outline" label={t('account.inviteClient')} onPress={go('/coach/invite')} />
            <LinkRow icon="documents-outline" label={t('account.planTemplates')} onPress={go('/coach/templates')} />
          </>
        ) : null}

        {role === 'admin' ? (
          <>
            <LinkRow
              icon="clipboard-outline"
              label={t('account.coachApplications')}
              onPress={go('/admin/applications')}
            />
            <LinkRow
              icon="shield-checkmark-outline"
              label={t('account.reportedMessages')}
              onPress={go('/admin/reports')}
            />
          </>
        ) : null}

        <LinkRow
          icon="book-outline"
          label={t('account.communityGuidelines')}
          onPress={go('/community-guidelines')}
        />
      </View>

      <LanguageSwitcher />

      <Button
        title={t('common.signOut')}
        variant="ghost"
        onPress={() => supabase.auth.signOut()}
        style={{ marginTop: theme.spacing.md }}
      />

      {/* Danger zone — irreversible account erasure (PDPL right-to-erasure). */}
      <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
        <Text variant="label" style={{ color: theme.colors.danger }}>
          {t('account.dangerZone')}
        </Text>
        <Pressable
          onPress={deleting ? undefined : onDeleteAccount}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.md,
            borderWidth: 1,
            borderColor: theme.colors.danger,
            opacity: pressed || deleting ? 0.7 : 1,
          })}
        >
          <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
          <Text variant="bodyStrong" style={{ flex: 1, color: theme.colors.danger }}>
            {deleting ? t('common.loading') : t('account.deleteAccount')}
          </Text>
        </Pressable>
        {deleteError ? (
          <Text variant="caption" style={{ color: theme.colors.danger }}>
            {deleteError}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

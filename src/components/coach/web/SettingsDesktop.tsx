// SettingsDesktop (W-view) — the desktop layout for the shared Settings hub, rendered
// ONLY inside the coach web shell (CoachWebChrome → ChromeContext.active). The mobile
// screen (app/settings.tsx) returns this after reading `useChrome().active`; the phone
// tree (link list + LanguageSwitcher) is untouched. Every value here is REAL: the name +
// email come from the signed-in profile/session, and the notification toggles call the
// SAME prefs API the mobile notification-settings screen uses (no invented toggles).
// Billing is a static, clearly-labelled "Pilot" panel — no billing data exists yet.
import { useEffect, useState } from 'react';
import { Switch, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { queryClient } from '@/lib/query';
import { getMyName, updateMyName } from '@/lib/profile';
import {
  getNotificationPrefs,
  setNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefKey,
} from '@/lib/notifications';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import {
  Badge,
  Button,
  Card,
  Icon,
  Input,
  Text,
  useToast,
  type IconName,
} from '@/components/ui';
import { forwardChevron, textStart } from '@/lib/rtl';
import { theme } from '@/theme';

// One notification toggle: the real pref key + its row icon + the i18n keys for the
// bold label and the muted description line. Order mirrors the mobile screen.
const PREF_ROWS: { key: NotificationPrefKey; icon: IconName; labelKey: string; descKey: string }[] = [
  { key: 'message', icon: 'chatbubble-ellipses-outline', labelKey: 'notifications.prefs.message', descKey: 'webportal.settings.prefDesc.message' },
  { key: 'coach_comment', icon: 'chatbox-ellipses-outline', labelKey: 'notifications.prefs.coachComment', descKey: 'webportal.settings.prefDesc.coachComment' },
  { key: 'plan_published', icon: 'document-text-outline', labelKey: 'notifications.prefs.planPublished', descKey: 'webportal.settings.prefDesc.planPublished' },
  { key: 'pr_achieved', icon: 'trophy-outline', labelKey: 'notifications.prefs.prAchieved', descKey: 'webportal.settings.prefDesc.prAchieved' },
  { key: 'client_note', icon: 'clipboard-outline', labelKey: 'notifications.prefs.clientNote', descKey: 'webportal.settings.prefDesc.clientNote' },
  { key: 'coach_request', icon: 'user-plus', labelKey: 'notifications.prefs.coachRequest', descKey: 'webportal.settings.prefDesc.coachRequest' },
];

// Uppercase section overline above each card.
function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="label" muted style={[{ marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }, textStart]}>
      {children}
    </Text>
  );
}

// A single notification toggle row. Module-scope → label/description arrive as props
// (no `t` of its own). The Switch reads cyan when on, matching the mobile screen.
function ToggleRow({
  icon,
  label,
  description,
  value,
  disabled,
  isFirst,
  onValueChange,
}: {
  icon: IconName;
  label: string;
  description: string;
  value: boolean;
  disabled: boolean;
  isFirst: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: theme.colors.border,
      }}
    >
      <Icon name={icon} size={20} color={theme.colors.primary} />
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text variant="bodyStrong" style={textStart}>
          {label}
        </Text>
        <Text variant="caption" muted style={textStart}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

export function SettingsDesktop() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const email = session?.user?.email ?? null;

  // ── Account: full name (editable) ────────────────────────────────────────
  const nameQ = useQuery({
    queryKey: ['my-name', userId],
    queryFn: () => getMyName(userId!),
    enabled: !!userId,
  });
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  useEffect(() => {
    if (nameQ.data != null) setName(nameQ.data);
  }, [nameQ.data]);

  const trimmed = name.trim();
  const nameDirty = trimmed.length > 0 && trimmed !== (nameQ.data ?? '').trim();

  const onSaveName = async () => {
    if (!userId || !nameDirty || savingName) return;
    setSavingName(true);
    try {
      await updateMyName(userId, trimmed);
      await queryClient.invalidateQueries({ queryKey: ['my-name', userId] });
      toast.show(t('common.saved'));
    } catch {
      toast.show(t('common.saveFailed'), 'error');
    } finally {
      setSavingName(false);
    }
  };

  // ── Notifications: real per-event prefs (same API as the mobile screen) ───
  const prefsQ = useQuery({
    queryKey: ['notification-prefs', userId],
    queryFn: () => getNotificationPrefs(),
    enabled: !!userId,
  });
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  useEffect(() => {
    if (prefsQ.data) setPrefs(prefsQ.data);
  }, [prefsQ.data]);

  const onTogglePref = (key: NotificationPrefKey) => async (v: boolean) => {
    if (!prefs || !userId) return;
    const prev = prefs;
    const next = { ...prefs, [key]: v };
    setPrefs(next);
    try {
      await setNotificationPrefs(userId, next);
      queryClient.invalidateQueries({ queryKey: ['notification-prefs', userId] });
    } catch {
      setPrefs(prev); // revert on failure
    }
  };

  const drillRow: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  };

  return (
    <View style={{ width: '100%' }}>
      {/* ── Account ─────────────────────────────────────────────────────── */}
      <SectionLabel>{t('webportal.settings.accountSection')}</SectionLabel>
      <Card style={{ gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.md }}>
          <Input
            label={t('webportal.settings.fullName')}
            value={name}
            onChangeText={setName}
            placeholder={t('webportal.settings.namePlaceholder')}
            onSubmitEditing={onSaveName}
            containerStyle={{ flex: 1 }}
          />
          <Button
            title={t('common.save')}
            fullWidth={false}
            loading={savingName}
            disabled={!nameDirty}
            onPress={onSaveName}
          />
        </View>

        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="label" muted style={textStart}>
            {t('auth.email')}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              backgroundColor: theme.colors.surfaceElevated,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.md,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.md,
            }}
          >
            <Icon name="mail" size={18} color={theme.colors.textMuted} />
            <Text variant="body" muted style={[{ flex: 1 }, textStart]} numberOfLines={1}>
              {email ?? '—'}
            </Text>
            <Icon name="lock" size={14} color={theme.colors.textMuted} />
          </View>
          <Text variant="caption" muted style={textStart}>
            {t('webportal.settings.emailReadonly')}
          </Text>
        </View>
      </Card>

      {/* ── Notifications ───────────────────────────────────────────────── */}
      <SectionLabel>{t('webportal.settings.notificationsSection')}</SectionLabel>
      <Card>
        <Text variant="caption" muted style={[{ marginBottom: theme.spacing.xs }, textStart]}>
          {t('notifications.settingsSub')}
        </Text>
        {PREF_ROWS.map((row, i) => (
          <ToggleRow
            key={row.key}
            icon={row.icon}
            label={t(row.labelKey)}
            description={t(row.descKey)}
            value={prefs ? prefs[row.key] : true}
            disabled={!prefs}
            isFirst={i === 0}
            onValueChange={onTogglePref(row.key)}
          />
        ))}
      </Card>

      {/* ── Call availability ───────────────────────────────────────────── */}
      <SectionLabel>{t('webportal.settings.availabilitySection')}</SectionLabel>
      <Card onPress={() => router.push('/coach/calls')}>
        <View style={drillRow}>
          <Icon name="calendar" size={20} color={theme.colors.primary} />
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text variant="bodyStrong" style={textStart}>
              {t('webportal.settings.manageHours')}
            </Text>
            <Text variant="caption" muted style={textStart}>
              {t('webportal.settings.manageHoursSub')}
            </Text>
          </View>
          <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
        </View>
      </Card>

      {/* ── Billing (Pilot — static, no billing data exists yet) ────────── */}
      <SectionLabel>{t('webportal.settings.billingSection')}</SectionLabel>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Icon name="ribbon" size={20} color={theme.colors.primary} />
          <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              <Text variant="bodyStrong" style={textStart}>
                {t('webportal.settings.billingValue')}
              </Text>
              <Badge label={t('webportal.settings.pilotBadge')} tone="primary" />
            </View>
            <Text variant="caption" muted style={textStart}>
              {t('webportal.settings.billingNote')}
            </Text>
          </View>
        </View>
      </Card>

      {/* ── Language ────────────────────────────────────────────────────── */}
      <SectionLabel>{t('webportal.settings.languageSection')}</SectionLabel>
      <Card>
        <LanguageSwitcher />
      </Card>
    </View>
  );
}

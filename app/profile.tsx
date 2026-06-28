// Profile hub (U-5). ONE screen replacing the three confusing Account rows (Edit Profile /
// Goals&Profile / Public Profile). Holds Identity inline — display name + @handle (U-6) +
// email — and links to the role-specific goals/coaching editor (/profile-setup) and the
// public-presence editor (/public-profile-edit). Identity name change is no longer an
// everyday action: the @handle is the unique anchor with a server-side 14-day cooldown.
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../src/lib/auth-context';
import {
  getMyName,
  updateMyName,
  getMyHandle,
  updateMyHandle,
  getMyAvatarMediaId,
  checkHandleAvailable,
  type HandleCheck,
} from '../src/lib/profile';
import { useUnsavedGuard } from '../src/lib/useUnsavedGuard';
import { handleSchema } from '../src/schemas/profile';
import { textStart } from '../src/lib/rtl';
import { ProfileAvatar } from '../src/components/ProfileAvatar';
import { SettingsLinkRow as LinkRow, SettingsSectionLabel as SectionLabel } from '../src/components/SettingsRow';
import { Screen, Text, Input, Button, Badge, useToast } from '../src/components/ui';
import { theme } from '../src/theme';

export default function Profile() {
  const { t } = useTranslation();
  const { session, role } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const userId = session?.user?.id;

  const [name, setName] = useState('');
  const [origName, setOrigName] = useState('');
  const [handle, setHandle] = useState('');
  const [origHandle, setOrigHandle] = useState('');
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<HandleCheck | null>(null); // handle availability
  const [checking, setChecking] = useState(false);

  const dirty = name.trim() !== origName || handle.trim().toLowerCase() !== origHandle;
  useUnsavedGuard(dirty && !saving, {
    title: t('common.unsavedTitle'),
    message: t('common.unsavedMessage'),
    discard: t('common.discard'),
    keep: t('common.keepEditing'),
  });

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [n, a] = await Promise.all([getMyName(userId), getMyAvatarMediaId(userId)]);
      setName(n ?? '');
      setOrigName((n ?? '').trim());
      setAvatarMediaId(a);
    } catch {
      /* leave name/avatar blank */
    }
    // Handle is fetched separately + tolerantly: before migration 0069 reaches the project
    // the column doesn't exist, and we don't want that to blank out name/avatar editing.
    try {
      const h = await getMyHandle(userId);
      setHandle(h ?? '');
      setOrigHandle((h ?? '').toLowerCase());
    } catch {
      /* handle not available yet (pre-0069) */
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Debounced availability check as the handle is edited (skip when unchanged/invalid).
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const candidate = handle.trim().toLowerCase();
    if (debounce.current) clearTimeout(debounce.current);
    if (candidate === origHandle || candidate === '') {
      setCheck(null);
      setChecking(false);
      return;
    }
    if (!handleSchema.safeParse(candidate).success) {
      setCheck({ available: false, reason: 'invalid' });
      setChecking(false);
      return;
    }
    setChecking(true);
    debounce.current = setTimeout(async () => {
      try {
        setCheck(await checkHandleAvailable(candidate));
      } catch {
        setCheck(null);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [handle, origHandle]);

  const handleHintColor = checking
    ? theme.colors.textMuted
    : check == null
      ? theme.colors.textMuted
      : check.available
        ? theme.colors.success
        : theme.colors.danger;
  const handleHint = checking
    ? t('profile.handleChecking')
    : check == null
      ? t('profile.handleHint')
      : check.available
        ? t('profile.handleAvailable')
        : t(`profile.handle${check.reason === 'taken' ? 'Taken' : check.reason === 'reserved' ? 'Reserved' : 'Invalid'}`);

  async function onSave() {
    setError(null);
    if (!userId) {
      setError(t('becomeCoach.sessionExpired'));
      return;
    }
    if (name.trim().length < 1) {
      setError(t('auth.enterName'));
      return;
    }
    const newHandle = handle.trim().toLowerCase();
    const handleChanged = newHandle !== origHandle;
    if (handleChanged && !handleSchema.safeParse(newHandle).success) {
      setError(t('profile.handleInvalid'));
      return;
    }
    setSaving(true);
    try {
      if (name.trim() !== origName) await updateMyName(userId, name);
      if (handleChanged) await updateMyHandle(userId, newHandle);
      setOrigName(name.trim());
      setOrigHandle(newHandle);
      setCheck(null);
      toast.show(t('common.saved'));
    } catch (e) {
      // The cooldown / taken / reserved cases surface server-side; keep the message generic.
      const msg = String((e as { message?: string })?.message ?? '').toLowerCase();
      setError(msg.includes('cooldown') ? t('profile.handleCooldown') : t('profile.handleSaveError'));
    } finally {
      setSaving(false);
    }
  }

  const isCoach = role === 'coach';
  const isClient = role === 'client';

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.xl }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Identity header */}
          <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <ProfileAvatar name={name || session?.user?.email || '?'} avatarMediaId={avatarMediaId} size={88} />
            <Text variant="h2">{name || t('account.setYourName')}</Text>
            {origHandle ? (
              <Text variant="caption" muted>
                @{origHandle}
              </Text>
            ) : null}
            {role ? <Badge label={role} tone="secondary" solid /> : null}
          </View>

          {/* Identity fields */}
          <View style={{ gap: theme.spacing.md }}>
            <SectionLabel>{t('profile.identity')}</SectionLabel>
            <Input
              label={t('profile.displayName')}
              value={name}
              onChangeText={setName}
              placeholder={t('auth.fullNamePlaceholder')}
              autoCapitalize="words"
              editable={!saving}
            />
            <View style={{ gap: 4 }}>
              <Input
                label={t('profile.handle')}
                value={handle}
                onChangeText={(v) => setHandle(v.replace(/[^a-zA-Z0-9_.]/g, '').toLowerCase())}
                placeholder={t('profile.handlePlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
                editable={!saving}
              />
              <Text variant="caption" style={[textStart, { color: handleHintColor }]}>
                {handleHint}
              </Text>
            </View>
            {session?.user?.email ? (
              <View style={{ gap: 2 }}>
                <Text variant="label" muted style={textStart}>
                  {t('profile.email')}
                </Text>
                <Text variant="body" muted style={textStart}>
                  {session.user.email}
                </Text>
              </View>
            ) : null}
            {error ? (
              <Text variant="caption" color="danger" style={textStart}>
                {error}
              </Text>
            ) : null}
            <Button title={t('common.save')} onPress={onSave} loading={saving} disabled={!dirty} size="lg" />
          </View>

          {/* Section links to the detailed editors (kept as their own screens). */}
          {isClient || isCoach ? (
            <View style={{ gap: theme.spacing.sm }}>
              <SectionLabel>{t('profile.more')}</SectionLabel>
              <LinkRow
                icon={isCoach ? 'ribbon-outline' : 'flag-outline'}
                label={isCoach ? t('profile.sectionCoaching') : t('profile.sectionGoals')}
                onPress={() => router.push('/profile-setup')}
              />
              <LinkRow
                icon="globe-outline"
                label={t('profile.sectionPublic')}
                onPress={() => router.push('/public-profile-edit')}
              />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

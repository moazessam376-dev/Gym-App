// Public profile editor (Phase 19). One focused screen — avatar, achievements and the
// public/private toggle — reached from Account. Keeps the goals questionnaire
// (profile-setup) unchanged. Visibility is OFF by default; the PUBLIC read path only ever
// exposes the allowlisted fields (name/avatar/goal/achievements for an athlete), never the
// sensitive profile data. Avatar uploads immediately (reusing the secure media pipeline);
// the toggle + achievements persist on Save.
import { useCallback, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack, useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../src/lib/auth-context';
import { forwardChevron, textStart } from '../src/lib/rtl';
import { getMyAvatarMediaId } from '../src/lib/profile';
import { getMyCoachProfile, setCoachVisibility } from '../src/lib/coach-profile';
import { getMyAthleteProfile, setAthleteVisibility } from '../src/lib/athlete-profile';
import { pickAndSetAvatar, type PickSource } from '../src/lib/upload';
import { ProfileAvatar } from '../src/components/ProfileAvatar';
import { Screen, Text, Input, Button, GlassCard } from '../src/components/ui';
import { theme } from '../src/theme';

const MAX_ACHIEVEMENTS = 20;

export default function PublicProfileEdit() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;
  const isCoach = role === 'coach';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isPublic, setIsPublic] = useState(false);
  const [achievements, setAchievements] = useState<string[]>([]);
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(null);
  const [avatarKey, setAvatarKey] = useState(0); // bump to re-mint the signed URL

  const name = session?.user?.email ?? '?';

  const load = useCallback(async () => {
    if (!userId || !role) return;
    try {
      const [avatar, profile] = await Promise.all([
        getMyAvatarMediaId(userId),
        isCoach ? getMyCoachProfile(userId) : getMyAthleteProfile(userId),
      ]);
      setAvatarMediaId(avatar);
      if (profile) {
        setIsPublic(profile.is_public);
        setAchievements(
          isCoach
            ? (profile as { achievements: string[] }).achievements
            : (profile as { public_achievements: string[] }).public_achievements,
        );
      }
    } catch {
      /* leave defaults */
    } finally {
      setLoading(false);
    }
  }, [userId, role, isCoach]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'coach' && role !== 'client') return <Redirect href="/" />;

  async function changePhoto(source: PickSource) {
    if (!userId) return;
    setError(null);
    setUploading(true);
    try {
      const res = await pickAndSetAvatar({ userId, source });
      if ('mediaId' in res) {
        setAvatarMediaId(res.mediaId);
        setAvatarKey((k) => k + 1);
      } else if ('denied' in res) {
        setError(t('publicProfile.photoError'));
      }
    } catch {
      setError(t('publicProfile.photoError'));
    } finally {
      setUploading(false);
    }
  }

  function updateAchievement(index: number, value: string) {
    setAchievements((prev) => prev.map((a, i) => (i === index ? value : a)));
  }
  function removeAchievement(index: number) {
    setAchievements((prev) => prev.filter((_, i) => i !== index));
  }
  function addAchievement() {
    setAchievements((prev) => (prev.length >= MAX_ACHIEVEMENTS ? prev : [...prev, '']));
  }

  async function onSave() {
    if (!userId) return;
    setError(null);
    setSaving(true);
    // Trim + drop blank achievement lines before persisting.
    const cleaned = achievements.map((a) => a.trim()).filter((a) => a.length > 0);
    try {
      if (isCoach) {
        await setCoachVisibility(userId, { is_public: isPublic, achievements: cleaned });
      } else {
        await setAthleteVisibility(userId, { is_public: isPublic, public_achievements: cleaned });
      }
      setAchievements(cleaned);
      router.back();
    } catch {
      setError(t('publicProfile.saveError'));
      setSaving(false);
    }
  }

  function viewPublic() {
    if (!userId) return;
    router.push(isCoach ? `/coach-profile/${userId}` : `/athlete-profile/${userId}`);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <Stack.Screen options={{ title: t('publicProfile.editTitle') }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.xl }}
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="body" muted style={textStart}>
            {isCoach ? t('publicProfile.editSubCoach') : t('publicProfile.editSubAthlete')}
          </Text>

          {/* Avatar */}
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <ProfileAvatar name={name} avatarMediaId={avatarMediaId} size={104} refreshKey={avatarKey} />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Button
                title={t('publicProfile.takePhoto')}
                variant="secondary"
                fullWidth={false}
                disabled={uploading}
                onPress={() => changePhoto('camera')}
                left={<Ionicons name="camera" size={16} color={theme.colors.text} />}
              />
              <Button
                title={t('publicProfile.chooseFromLibrary')}
                variant="secondary"
                fullWidth={false}
                disabled={uploading}
                onPress={() => changePhoto('library')}
                left={<Ionicons name="images" size={16} color={theme.colors.text} />}
              />
            </View>
            {uploading ? <ActivityIndicator color={theme.colors.primary} /> : null}
          </View>

          {/* Visibility toggle */}
          <GlassCard style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {t('publicProfile.visibility')}
              </Text>
              <Switch
                value={isPublic}
                onValueChange={setIsPublic}
                trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
              />
            </View>
            <Text variant="caption" muted style={textStart}>
              {isPublic
                ? isCoach
                  ? t('publicProfile.visibilityOnCoach')
                  : t('publicProfile.visibilityOnAthlete')
                : t('publicProfile.visibilityOff')}
            </Text>
            <Text variant="caption" muted style={textStart}>
              {t('publicProfile.whoCanSee')}
            </Text>
          </GlassCard>

          {/* Achievements */}
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" muted style={textStart}>
              {t('publicProfile.achievements')}
            </Text>
            <Text variant="caption" muted style={textStart}>
              {isCoach ? t('publicProfile.achievementsSubCoach') : t('publicProfile.achievementsSubAthlete')}
            </Text>
            {achievements.map((a, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Input
                  value={a}
                  onChangeText={(v) => updateAchievement(i, v)}
                  placeholder={t('publicProfile.achievementPlaceholder')}
                  maxLength={200}
                  style={{ flex: 1 }}
                />
                <Pressable onPress={() => removeAchievement(i)} hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color={theme.colors.textMuted} />
                </Pressable>
              </View>
            ))}
            {achievements.length < MAX_ACHIEVEMENTS ? (
              <Pressable
                onPress={addAchievement}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  paddingVertical: theme.spacing.sm,
                }}
              >
                <Ionicons name="add-circle-outline" size={20} color={theme.colors.primary} />
                <Text variant="bodyStrong" color={theme.colors.primary}>
                  {t('publicProfile.addAchievement')}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* View my public profile */}
          <Pressable
            onPress={viewPublic}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.glass,
              borderWidth: 1,
              borderColor: theme.colors.glassBorder,
            }}
          >
            <Ionicons name="eye-outline" size={20} color={theme.colors.primary} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t('publicProfile.viewPublic')}
            </Text>
            <Ionicons name={forwardChevron()} size={18} color={theme.colors.textMuted} />
          </Pressable>

          {error ? (
            <Text variant="caption" color="danger" style={textStart}>
              {error}
            </Text>
          ) : null}
          <Button title={t('common.save')} onPress={onSave} loading={saving} size="lg" />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

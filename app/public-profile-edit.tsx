// Public profile editor (Phase 19). One focused screen — avatar, achievements and the
// public/private toggle — reached from Account. Keeps the goals questionnaire
// (profile-setup) unchanged. Visibility is OFF by default; the PUBLIC read path only ever
// exposes the allowlisted fields (name/avatar/goal/achievements for an athlete), never the
// sensitive profile data. Avatar uploads immediately (reusing the secure media pipeline);
// the toggle + achievements persist on Save.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { Redirect, Stack, useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../src/lib/auth-context';
import { forwardChevron, textStart } from '../src/lib/rtl';
import { useUnsavedGuard } from '../src/lib/useUnsavedGuard';
import { getMyAvatarMediaId, setMyAvatar } from '../src/lib/profile';
import { getMyCoachProfile, setCoachVisibility } from '../src/lib/coach-profile';
import { getMyAthleteProfile, setAthleteVisibility } from '../src/lib/athlete-profile';
import { pickAvatar, type PickSource } from '../src/lib/upload';
import { ProfileAvatar } from '../src/components/ProfileAvatar';
import { Icon, Screen, Text, Input, Button, GlassCard, useToast } from '../src/components/ui';
import { theme } from '../src/theme';

// Self-assigned achievements are capped at 3 (founder decision; enforced in DB by 0074).
// System-minted trophies (0073) are unlimited and live on the public profile, not here.
const MAX_ACHIEVEMENTS = 3;

export default function PublicProfileEdit() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const userId = session?.user?.id;
  const isCoach = role === 'coach';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isPublic, setIsPublic] = useState(false);
  const [leaderboardOptIn, setLeaderboardOptIn] = useState(false);
  const [shareBody, setShareBody] = useState(false); // athlete: share transformation on my profile
  const [allowTransform, setAllowTransform] = useState(false); // athlete: let my coach feature me
  const [achievements, setAchievements] = useState<string[]>([]);
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(null);
  const [avatarDirty, setAvatarDirty] = useState(false); // a new photo is picked but not yet saved
  const [avatarKey, setAvatarKey] = useState(0); // bump to re-mint the signed URL

  // Unsaved-changes guard: any edit marks the form dirty. On a successful save we
  // clear dirty + flag `leaving`, and an effect navigates back once dirty is false —
  // so saving itself never trips the "discard changes?" prompt (the guard reads the
  // re-rendered preventRemove=false before we pop).
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useUnsavedGuard(dirty, {
    title: t('common.unsavedTitle'),
    message: t('common.unsavedMessage'),
    discard: t('common.discard'),
    keep: t('common.keepEditing'),
  });
  useEffect(() => {
    if (leaving && !dirty) router.back();
  }, [leaving, dirty, router]);

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
        setLeaderboardOptIn(profile.leaderboard_opt_in);
        if (!isCoach) {
          const ap = profile as { share_body_metrics_publicly?: boolean; allow_transformation_sharing?: boolean };
          setShareBody(ap.share_body_metrics_publicly ?? false);
          setAllowTransform(ap.allow_transformation_sharing ?? false);
        }
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
      // Upload now (for the preview) but DON'T link it to the profile — that happens on
      // Save, so picking a photo and leaving without saving doesn't change your avatar.
      const res = await pickAvatar(source);
      if ('mediaId' in res) {
        setAvatarMediaId(res.mediaId);
        setAvatarDirty(true);
        setDirty(true);
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
    setDirty(true);
  }
  function removeAchievement(index: number) {
    setAchievements((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }
  function addAchievement() {
    setAchievements((prev) => (prev.length >= MAX_ACHIEVEMENTS ? prev : [...prev, '']));
    setDirty(true);
  }

  async function onSave() {
    if (!userId) return;
    setError(null);
    setSaving(true);
    // Trim + drop blank achievement lines before persisting.
    const cleaned = achievements.map((a) => a.trim()).filter((a) => a.length > 0);
    try {
      // Link the newly-picked avatar (if any) only now, on Save.
      if (avatarDirty) await setMyAvatar(userId, avatarMediaId);
      // The board needs a public profile to link to, so opting in only persists while public.
      const optIn = isPublic && leaderboardOptIn;
      if (isCoach) {
        await setCoachVisibility(userId, { is_public: isPublic, achievements: cleaned, leaderboard_opt_in: optIn });
      } else {
        await setAthleteVisibility(userId, {
          is_public: isPublic,
          public_achievements: cleaned,
          leaderboard_opt_in: optIn,
          share_body_metrics_publicly: isPublic && shareBody,
          allow_transformation_sharing: isPublic && allowTransform,
        });
      }
      setAchievements(cleaned);
      // Clear dirty + flag leaving so the effect pops AFTER the guard sees a clean form.
      // The toast lives at the root, so it stays visible on the screen we return to.
      setDirty(false);
      setLeaving(true);
      toast.show(t('common.saved'));
    } catch {
      setError(t('publicProfile.saveError'));
      toast.show(t('common.saveFailed'), 'error');
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
                left={<Icon name="camera" size={16} color={theme.colors.text} />}
              />
              <Button
                title={t('publicProfile.chooseFromLibrary')}
                variant="secondary"
                fullWidth={false}
                disabled={uploading}
                onPress={() => changePhoto('library')}
                left={<Icon name="images" size={16} color={theme.colors.text} />}
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
                onValueChange={(v) => {
                  setIsPublic(v);
                  setDirty(true);
                }}
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

          {/* Leaderboard opt-in (Phase 20) — a separate, bigger disclosure than a profile
              page, so its own consent. Only available once the profile is public. */}
          <GlassCard style={{ gap: theme.spacing.sm, opacity: isPublic ? 1 : 0.55 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {t('publicProfile.leaderboardTitle')}
              </Text>
              <Switch
                value={isPublic && leaderboardOptIn}
                onValueChange={(v) => {
                  setLeaderboardOptIn(v);
                  setDirty(true);
                }}
                disabled={!isPublic}
                trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
              />
            </View>
            <Text variant="caption" muted style={textStart}>
              {isCoach ? t('publicProfile.leaderboardSubCoach') : t('publicProfile.leaderboardSubAthlete')}
            </Text>
            {!isPublic ? (
              <Text variant="caption" muted style={textStart}>
                {t('publicProfile.leaderboardNeedsPublic')}
              </Text>
            ) : null}
          </GlassCard>

          {/* Athlete-only consents (E2/E3): share transformation on my profile, and let my
              coach feature my before/after. Independent of is_public/leaderboard. */}
          {!isCoach ? (
            <>
              <GlassCard style={{ gap: theme.spacing.sm, opacity: isPublic ? 1 : 0.55 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {t('publicProfile.shareBodyTitle')}
                  </Text>
                  <Switch
                    value={isPublic && shareBody}
                    onValueChange={(v) => {
                      setShareBody(v);
                      setDirty(true);
                    }}
                    disabled={!isPublic}
                    trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
                  />
                </View>
                <Text variant="caption" muted style={textStart}>
                  {t('publicProfile.shareBodySub')}
                </Text>
              </GlassCard>
              <GlassCard style={{ gap: theme.spacing.sm, opacity: isPublic ? 1 : 0.55 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {t('publicProfile.allowTransformTitle')}
                  </Text>
                  <Switch
                    value={isPublic && allowTransform}
                    onValueChange={(v) => {
                      setAllowTransform(v);
                      setDirty(true);
                    }}
                    disabled={!isPublic}
                    trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
                  />
                </View>
                <Text variant="caption" muted style={textStart}>
                  {t('publicProfile.allowTransformSub')}
                </Text>
              </GlassCard>
            </>
          ) : null}

          {/* Achievements */}
          <View style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <Text variant="label" muted style={[textStart, { flex: 1 }]}>
                {t('publicProfile.achievements')}
              </Text>
              <Text variant="caption" muted>
                {achievements.length}/{MAX_ACHIEVEMENTS}
              </Text>
            </View>
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
                  <Icon name="close-circle" size={22} color={theme.colors.textMuted} />
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
                <Icon name="add-circle-outline" size={20} color={theme.colors.primary} />
                <Text variant="bodyStrong" color={theme.colors.primary}>
                  {t('publicProfile.addAchievement')}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Coach: manage the transformations showcase (E3) */}
          {isCoach ? (
            <Pressable
              onPress={() => router.push('/coach/transformations')}
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
              <Icon name="images" size={20} color={theme.colors.primary} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {t('coachProfile.manageTransformations')}
              </Text>
              <Icon name={forwardChevron()} size={18} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}

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
            <Icon name="eye-outline" size={20} color={theme.colors.primary} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t('publicProfile.viewPublic')}
            </Text>
            <Icon name={forwardChevron()} size={18} color={theme.colors.textMuted} />
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

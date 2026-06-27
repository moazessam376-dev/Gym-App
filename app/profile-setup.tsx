// Profile / goals questionnaire — role-branched (athlete vs coach). Used for
// first-time onboarding AND later editing. Saves to athlete_profile / coach_profile
// (migration 0017) via the allowlisted data layer. Goals here are read downstream
// by macro targets (P10), progress (P11), ranks (P12).
//
// Slice H1: the ATHLETE flow is a guided 4-step wizard (a long form is intimidating
// on first run) with tappable step dots so an editor can jump straight to a field.
// The coach flow stays a single form.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../src/lib/auth-context';
import {
  getMyAthleteProfile,
  upsertAthleteProfile,
  type AthleteProfile,
} from '../src/lib/athlete-profile';
import { getMyCoachProfile, upsertCoachProfile, type CoachProfile } from '../src/lib/coach-profile';
import {
  activityLevelSchema,
  athleteGoalSchema,
  dietaryTagSchema,
  experienceLevelSchema,
  sexSchema,
  type ActivityLevel,
  type AthleteGoal,
  type DietaryTag,
  type ExperienceLevel,
  type Sex,
} from '../src/schemas/athlete-profile';
import { specialtySchema, type Specialty } from '../src/schemas/coach-profile';
import { Icon, Screen, Text, Input, Button, Chip } from '../src/components/ui';
import { forwardChevron, textStart } from '../src/lib/rtl';
import { theme } from '../src/theme';

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="label" muted style={textStart}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function ChipGroup<T extends string>({
  options,
  selected,
  onToggle,
  labelFor,
}: {
  options: readonly T[];
  selected: T[];
  onToggle: (v: T) => void;
  labelFor: (v: T) => string;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
      {options.map((o) => (
        <Chip key={o} label={labelFor(o)} active={selected.includes(o)} onPress={() => onToggle(o)} />
      ))}
    </View>
  );
}

// A selectable row (title + explanation) for single-choice options that need a hint.
function OptionRows<T extends string>({
  options,
  hints,
  value,
  onChange,
  labelFor,
}: {
  options: readonly T[];
  hints: Record<T, string>;
  value: T | null;
  onChange: (v: T) => void;
  labelFor: (v: T) => string;
}) {
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {options.map((o) => {
        const active = value === o;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={labelFor(o)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor: active ? theme.colors.primarySoft : theme.colors.glass,
              borderWidth: 1,
              borderColor: active ? theme.colors.primary : theme.colors.glassBorder,
            }}
          >
            <Icon
              name={active ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={active ? theme.colors.primary : theme.colors.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" style={textStart}>{labelFor(o)}</Text>
              <Text variant="caption" muted style={textStart}>
                {hints[o]}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tappable progress dots for the athlete wizard (jump to any step). */
function StepDots({ total, step, onJump }: { total: number; step: number; onJump: (i: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
      {Array.from({ length: total }).map((_, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <Pressable key={i} onPress={() => onJump(i)} hitSlop={8} accessibilityRole="button">
            <View
              style={{
                width: active ? 26 : 9,
                height: 9,
                borderRadius: theme.radii.full,
                backgroundColor: active || done ? theme.colors.primary : theme.colors.glassBorder,
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function gramsToKg(g: number | null): string {
  return g == null ? '' : String(Math.round(g / 1000));
}
function intOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

const ATHLETE_STEPS = 4;

export default function ProfileSetup() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;
  const isCoach = role === 'coach';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  // athlete state
  const [goal, setGoal] = useState<AthleteGoal | null>(null);
  const [experience, setExperience] = useState<ExperienceLevel>('beginner');
  const [sex, setSex] = useState<Sex | null>(null);
  const [activity, setActivity] = useState<ActivityLevel | null>(null);
  const [heightCm, setHeightCm] = useState('');
  const [targetKg, setTargetKg] = useState('');
  const [trainingDays, setTrainingDays] = useState('');
  const [diet, setDiet] = useState<DietaryTag[]>([]);
  const [injuries, setInjuries] = useState('');

  // coach state
  const [bio, setBio] = useState('');
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [years, setYears] = useState('');
  const [certs, setCerts] = useState('');

  const load = useCallback(async () => {
    if (!userId || !role) return;
    try {
      if (isCoach) {
        const p: CoachProfile | null = await getMyCoachProfile(userId);
        if (p) {
          setBio(p.bio ?? '');
          setSpecialties(p.specialties);
          setYears(p.years_experience?.toString() ?? '');
          setCerts(p.certifications ?? '');
        }
      } else {
        const p: AthleteProfile | null = await getMyAthleteProfile(userId);
        if (p) {
          setGoal(p.primary_goal);
          setExperience(p.experience_level ?? 'beginner');
          setSex(p.sex);
          setActivity(p.activity_level);
          setHeightCm(p.height_cm?.toString() ?? '');
          setTargetKg(gramsToKg(p.target_weight_grams));
          setTrainingDays(p.training_days?.toString() ?? '');
          setDiet(p.dietary_tags);
          setInjuries(p.injuries_notes ?? '');
        }
      }
    } catch {
      /* leave blank */
    } finally {
      setLoading(false);
    }
  }, [userId, role, isCoach]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Hints are built here (the screen has `t`), not at module scope, so they localize.
  const experienceHints: Record<ExperienceLevel, string> = useMemo(
    () => ({
      beginner: t('profileSetup.expHint.beginner'),
      intermediate: t('profileSetup.expHint.intermediate'),
      advanced: t('profileSetup.expHint.advanced'),
    }),
    [t],
  );
  const activityHints: Record<ActivityLevel, string> = useMemo(
    () => ({
      sedentary: t('profileSetup.activityHint.sedentary'),
      light: t('profileSetup.activityHint.light'),
      moderate: t('profileSetup.activityHint.moderate'),
      active: t('profileSetup.activityHint.active'),
      very_active: t('profileSetup.activityHint.very_active'),
    }),
    [t],
  );

  if (role && role !== 'coach' && role !== 'client') return <Redirect href="/" />;
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  function toggle<T extends string>(list: T[], set: (v: T[]) => void, v: T) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  async function onSave() {
    if (!userId) return;
    setError(null);
    setSaving(true);
    try {
      if (isCoach) {
        await upsertCoachProfile(userId, {
          bio: bio.trim() || null,
          specialties,
          years_experience: intOrNull(years),
          certifications: certs.trim() || null,
        });
      } else {
        const kg = intOrNull(targetKg);
        await upsertAthleteProfile(userId, {
          primary_goal: goal,
          experience_level: experience,
          sex,
          activity_level: activity,
          height_cm: intOrNull(heightCm),
          target_weight_grams: kg != null ? kg * 1000 : null,
          training_days: intOrNull(trainingDays),
          dietary_tags: diet,
          injuries_notes: injuries.trim() || null,
        });
      }
      router.back();
    } catch {
      setError(t('profileSetup.saveError'));
      setSaving(false);
    }
  }

  // ── Coach: the existing single form ───────────────────────────────────────
  if (isCoach) {
    return (
      <Screen gradient padded={false} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.xl }} keyboardShouldPersistTaps="handled">
            <View>
              <Text variant="h1" style={textStart}>{t('profileSetup.coachTitle')}</Text>
              <Text variant="body" muted style={textStart}>
                {t('profileSetup.coachIntro')}
              </Text>
            </View>
            <Field title={t('profileSetup.bio')}>
              <Input value={bio} onChangeText={setBio} placeholder={t('profileSetup.bioPlaceholder')} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
            </Field>
            <Field title={t('profileSetup.specialtiesField')}>
              <ChipGroup
                options={specialtySchema.options}
                selected={specialties}
                onToggle={(v) => toggle(specialties, setSpecialties, v)}
                labelFor={(v) => t(`profileSetup.specialty.${v}`)}
              />
            </Field>
            <Field title={t('profileSetup.years')}>
              <Input value={years} onChangeText={setYears} keyboardType="number-pad" placeholder={t('profileSetup.yearsPlaceholder')} />
            </Field>
            <Field title={t('profileSetup.certs')}>
              <Input value={certs} onChangeText={setCerts} placeholder={t('profileSetup.certsPlaceholder')} multiline style={{ minHeight: 60, textAlignVertical: 'top' }} />
            </Field>
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

  // ── Athlete: the guided 4-step wizard ─────────────────────────────────────
  const stepTitles = [
    t('profileSetup.step.goal'),
    t('profileSetup.step.about'),
    t('profileSetup.step.targets'),
    t('profileSetup.step.preferences'),
  ];
  const canAdvance = step !== 0 || goal != null; // step 1 needs a goal — the wizard's point
  const isLast = step === ATHLETE_STEPS - 1;
  const goNext = () => (isLast ? onSave() : setStep((s) => Math.min(ATHLETE_STEPS - 1, s + 1)));

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.xl, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {/* Stepper header */}
          <View style={{ gap: theme.spacing.md }}>
            <StepDots total={ATHLETE_STEPS} step={step} onJump={setStep} />
            <View>
              <Text variant="label" color="primary" style={textStart}>
                {t('profileSetup.stepOf', { n: step + 1, total: ATHLETE_STEPS })}
              </Text>
              <Text variant="h1" style={textStart}>{stepTitles[step]}</Text>
            </View>
          </View>

          {/* Step content */}
          <View style={{ gap: theme.spacing.xl, flex: 1 }}>
            {step === 0 ? (
              <>
                <Field title={t('profileSetup.primaryGoal')}>
                  <ChipGroup
                    options={athleteGoalSchema.options}
                    selected={goal ? [goal] : []}
                    onToggle={(v) => setGoal(goal === v ? null : v)}
                    labelFor={(v) => t(`goals.${v}`)}
                  />
                </Field>
                <Field title={t('profileSetup.experienceField')}>
                  <OptionRows
                    options={experienceLevelSchema.options}
                    hints={experienceHints}
                    value={experience}
                    onChange={setExperience}
                    labelFor={(v) => t(`profileSetup.exp.${v}`)}
                  />
                </Field>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <Field title={t('profileSetup.sexField')}>
                  <ChipGroup
                    options={sexSchema.options}
                    selected={sex ? [sex] : []}
                    onToggle={(v) => setSex(sex === v ? null : v)}
                    labelFor={(v) => t(`profileSetup.sex.${v}`)}
                  />
                </Field>
                <Field title={t('profileSetup.height')}>
                  <Input value={heightCm} onChangeText={setHeightCm} keyboardType="number-pad" placeholder="178" />
                </Field>
                <Field title={t('profileSetup.activityField')}>
                  <OptionRows
                    options={activityLevelSchema.options}
                    hints={activityHints}
                    value={activity}
                    onChange={setActivity}
                    labelFor={(v) => t(`profileSetup.activity.${v}`)}
                  />
                </Field>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <Field title={t('profileSetup.targetWeight')}>
                  <Input value={targetKg} onChangeText={setTargetKg} keyboardType="number-pad" placeholder="82" />
                </Field>
                <Field title={t('profileSetup.trainingDays')}>
                  <ChipGroup
                    options={['0', '1', '2', '3', '4', '5', '6', '7'] as const}
                    selected={trainingDays ? [trainingDays] : []}
                    onToggle={(v) => setTrainingDays(trainingDays === v ? '' : v)}
                    labelFor={(v) => v}
                  />
                </Field>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <Field title={t('profileSetup.dietField')}>
                  <ChipGroup
                    options={dietaryTagSchema.options}
                    selected={diet}
                    onToggle={(v) => toggle(diet, setDiet, v)}
                    labelFor={(v) => t(`profileSetup.diet.${v}`)}
                  />
                </Field>
                <Field title={t('profileSetup.favFoods')}>
                  <Pressable
                    onPress={() => router.push('/food/preferences')}
                    accessibilityRole="button"
                    accessibilityLabel={t('profileSetup.favFoodsTitle')}
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
                    <Icon name="heart" size={20} color={theme.colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" style={textStart}>{t('profileSetup.favFoodsTitle')}</Text>
                      <Text variant="caption" muted style={textStart}>
                        {t('profileSetup.favFoodsSub')}
                      </Text>
                    </View>
                    <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
                  </Pressable>
                </Field>
                <Field title={t('profileSetup.injuries')}>
                  <Input value={injuries} onChangeText={setInjuries} placeholder={t('profileSetup.injuriesPlaceholder')} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
                </Field>
              </>
            ) : null}
          </View>

          {error ? (
            <Text variant="caption" color="danger" style={textStart}>
              {error}
            </Text>
          ) : null}

          {/* Footer nav */}
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            {step > 0 ? (
              <Button title={t('common.back')} variant="secondary" onPress={() => setStep((s) => s - 1)} style={{ flex: 1 }} />
            ) : null}
            <Button
              title={isLast ? t('common.save') : t('common.next')}
              onPress={goNext}
              loading={saving}
              disabled={!canAdvance}
              style={{ flex: 1 }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

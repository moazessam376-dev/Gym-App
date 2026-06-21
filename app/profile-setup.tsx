// Profile / goals questionnaire — role-branched (athlete vs coach). Used for
// first-time onboarding AND later editing. Saves to athlete_profile / coach_profile
// (migration 0017) via the allowlisted data layer. Goals here are read downstream
// by macro targets (P10), progress (P11), ranks (P12).
import { useCallback, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
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
import { Screen, Text, Input, Button, Chip, Segmented } from '../src/components/ui';
import { theme } from '../src/theme';

function label(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="label" muted>
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
}: {
  options: readonly T[];
  selected: T[];
  onToggle: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
      {options.map((o) => (
        <Chip key={o} label={label(o)} active={selected.includes(o)} onPress={() => onToggle(o)} />
      ))}
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

export default function ProfileSetup() {
  const { role, session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;
  const isCoach = role === 'coach';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError('Could not save. Please check your inputs and try again.');
      setSaving(false);
    }
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.xl }} keyboardShouldPersistTaps="handled">
          <View>
            <Text variant="h1">{isCoach ? 'Your coaching profile' : 'Your goals'}</Text>
            <Text variant="body" muted>
              {isCoach
                ? 'Tell clients about your coaching. They can see this on their home.'
                : 'This helps your coach tailor your training & nutrition.'}
            </Text>
          </View>

          {isCoach ? (
            <>
              <Field title="Bio">
                <Input value={bio} onChangeText={setBio} placeholder="A short intro for your clients" multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
              </Field>
              <Field title="Specialties">
                <ChipGroup options={specialtySchema.options} selected={specialties} onToggle={(v) => toggle(specialties, setSpecialties, v)} />
              </Field>
              <Field title="Years of experience">
                <Input value={years} onChangeText={setYears} keyboardType="number-pad" placeholder="e.g. 5" />
              </Field>
              <Field title="Certifications">
                <Input value={certs} onChangeText={setCerts} placeholder="e.g. NASM CPT, Precision Nutrition" multiline style={{ minHeight: 60, textAlignVertical: 'top' }} />
              </Field>
            </>
          ) : (
            <>
              <Field title="Primary goal">
                <ChipGroup options={athleteGoalSchema.options} selected={goal ? [goal] : []} onToggle={(v) => setGoal(goal === v ? null : v)} />
              </Field>
              <Field title="Experience">
                <Segmented
                  value={experience}
                  onChange={setExperience}
                  options={experienceLevelSchema.options.map((o) => ({ value: o, label: label(o) }))}
                />
              </Field>
              <Field title="Sex (for calorie estimates)">
                <ChipGroup options={sexSchema.options} selected={sex ? [sex] : []} onToggle={(v) => setSex(sex === v ? null : v)} />
              </Field>
              <Field title="Activity level">
                <ChipGroup options={activityLevelSchema.options} selected={activity ? [activity] : []} onToggle={(v) => setActivity(activity === v ? null : v)} />
              </Field>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <Field title="Height (cm)">
                  <Input value={heightCm} onChangeText={setHeightCm} keyboardType="number-pad" placeholder="178" />
                </Field>
                <Field title="Target weight (kg)">
                  <Input value={targetKg} onChangeText={setTargetKg} keyboardType="number-pad" placeholder="82" />
                </Field>
              </View>
              <Field title="Training days / week">
                <ChipGroup
                  options={['0', '1', '2', '3', '4', '5', '6', '7'] as const}
                  selected={trainingDays ? [trainingDays] : []}
                  onToggle={(v) => setTrainingDays(trainingDays === v ? '' : v)}
                />
              </Field>
              <Field title="Dietary preferences">
                <ChipGroup options={dietaryTagSchema.options} selected={diet} onToggle={(v) => toggle(diet, setDiet, v)} />
              </Field>
              <Field title="Injuries / notes">
                <Input value={injuries} onChangeText={setInjuries} placeholder="Anything your coach should know" multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
              </Field>
            </>
          )}

          {error ? (
            <Text variant="caption" color="danger">
              {error}
            </Text>
          ) : null}
          <Button title="Save" onPress={onSave} loading={saving} size="lg" />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

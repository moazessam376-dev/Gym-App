// Coach → enter a VERIFIED InBody reading for a client (migration 0026). The coach
// is the human-in-the-loop (foundations §4): they read the athlete's uploaded InBody
// sheet and type the numbers. The DB stamps them as the verifier. Integer units —
// the form takes kg / % and converts to grams / basis points before saving.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { addBodyMetric } from '../../src/lib/body-metrics';
import { Screen, Text, Input, Button, GlassCard } from '../../src/components/ui';
import { theme } from '../../src/theme';

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Parse a positive decimal; null if blank/invalid.
function num(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function AddBodyMetric() {
  const { role } = useAuth();
  const router = useRouter();
  const { clientId, clientName } = useLocalSearchParams<{ clientId?: string; clientName?: string }>();

  const [date, setDate] = useState(todayISODate());
  const [weight, setWeight] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [muscle, setMuscle] = useState('');
  const [visceral, setVisceral] = useState('');
  const [bmr, setBmr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role && role !== 'coach') return <Redirect href="/" />;

  async function onSave() {
    if (!clientId) return;
    setError(null);
    const w = num(weight);
    if (w == null || w <= 0) {
      setError('Enter the weight (kg) from the sheet.');
      return;
    }
    const bf = num(bodyFat);
    const mm = num(muscle);
    const vf = num(visceral);
    const bm = num(bmr);
    // Validate the date as YYYY-MM-DD → UTC midnight ISO.
    const measured = /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
      ? new Date(`${date.trim()}T00:00:00Z`).toISOString()
      : undefined;

    setBusy(true);
    try {
      await addBodyMetric(clientId, {
        measured_at: measured,
        weight_grams: Math.round(w * 1000),
        body_fat_bp: bf == null ? null : Math.round(bf * 100),
        skeletal_muscle_mass_grams: mm == null ? null : Math.round(mm * 1000),
        visceral_fat_level: vf == null ? null : Math.round(vf),
        bmr_kcal: bm == null ? null : Math.round(bm),
      });
      router.back();
    } catch {
      setError('Could not save that reading. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md }}
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="h2">New InBody reading</Text>
          {clientName ? (
            <Text variant="caption" muted>
              For {clientName}
            </Text>
          ) : null}

          <GlassCard style={{ gap: theme.spacing.md }}>
            <Text variant="caption" muted>
              Enter the values from the client’s InBody sheet. Only weight is required.
            </Text>

            <Input label="Test date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            <Input label="Weight (kg)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="e.g. 92.5" error={error} />
            <Input label="Body fat (%)" value={bodyFat} onChangeText={setBodyFat} keyboardType="decimal-pad" placeholder="e.g. 25.6" />
            <Input label="Skeletal muscle mass (kg)" value={muscle} onChangeText={setMuscle} keyboardType="decimal-pad" placeholder="e.g. 39.2" />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Input containerStyle={{ flex: 1 }} label="Visceral fat" value={visceral} onChangeText={setVisceral} keyboardType="number-pad" placeholder="level" />
              <Input containerStyle={{ flex: 1 }} label="BMR (kcal)" value={bmr} onChangeText={setBmr} keyboardType="number-pad" placeholder="e.g. 1857" />
            </View>
          </GlassCard>

          <Button title="Save verified reading" onPress={onSave} loading={busy} />
          <Text variant="caption" muted style={{ textAlign: 'center' }}>
            Saved as coach-verified — this is what progress and ranks read.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

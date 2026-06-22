// Coach → enter OR confirm a VERIFIED InBody reading for a client (migration 0026 +
// Phase 12b). The coach is the human-in-the-loop (foundations §4): they read the
// athlete's InBody sheet and the numbers are stamped coach-verified by the DB trigger.
//
// Two modes on one screen:
//   • New reading (no ?metricId) — a blank kg/% form → addBodyMetric (12a).
//   • Confirm (?metricId) — an OCR-staged row (source='inbody_ocr', unverified). The
//     form is PRE-FILLED from the model's read and the source scan is shown so the coach
//     verifies/corrects against it, then Confirm → confirmOcrMetric flips it verified, or
//     Discard → deleteBodyMetric drops the misread. (Phase 12b)
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import {
  addBodyMetric,
  confirmOcrMetric,
  deleteBodyMetric,
  getBodyMetric,
} from '../../src/lib/body-metrics';
import { Screen, Text, Input, Button, GlassCard, SignedImage } from '../../src/components/ui';
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

export default function BodyMetricScreen() {
  const { role } = useAuth();
  const router = useRouter();
  const { clientId, clientName, metricId } = useLocalSearchParams<{
    clientId?: string;
    clientName?: string;
    metricId?: string;
  }>();
  const confirmMode = !!metricId;

  const [date, setDate] = useState(todayISODate());
  const [weight, setWeight] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [muscle, setMuscle] = useState('');
  const [visceral, setVisceral] = useState('');
  const [bmr, setBmr] = useState('');
  // Preserved through a confirm (the form has no field for it — keep the OCR value).
  const [bodyFatMassGrams, setBodyFatMassGrams] = useState<number | null>(null);
  const [scanMediaId, setScanMediaId] = useState<string | null>(null);
  const [loadingMetric, setLoadingMetric] = useState(confirmMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Confirm mode: load the OCR row and pre-fill the form from it.
  useEffect(() => {
    if (!metricId) return;
    let active = true;
    (async () => {
      try {
        const m = await getBodyMetric(metricId);
        if (active && m) {
          setDate(new Date(m.measured_at).toISOString().slice(0, 10));
          setWeight(String(m.weight_grams / 1000));
          if (m.body_fat_bp != null) setBodyFat(String(m.body_fat_bp / 100));
          if (m.skeletal_muscle_mass_grams != null) setMuscle(String(m.skeletal_muscle_mass_grams / 1000));
          if (m.visceral_fat_level != null) setVisceral(String(m.visceral_fat_level));
          if (m.bmr_kcal != null) setBmr(String(m.bmr_kcal));
          setBodyFatMassGrams(m.body_fat_mass_grams);
          setScanMediaId(m.media_id);
        }
      } catch {
        if (active) setError('Could not load this reading.');
      } finally {
        if (active) setLoadingMetric(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [metricId]);

  if (role && role !== 'coach') return <Redirect href="/" />;

  async function onSave() {
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
    const measured = /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
      ? new Date(`${date.trim()}T00:00:00Z`).toISOString()
      : undefined;

    setBusy(true);
    try {
      if (confirmMode && metricId) {
        await confirmOcrMetric(metricId, {
          measured_at: measured,
          weight_grams: Math.round(w * 1000),
          body_fat_bp: bf == null ? null : Math.round(bf * 100),
          skeletal_muscle_mass_grams: mm == null ? null : Math.round(mm * 1000),
          body_fat_mass_grams: bodyFatMassGrams, // preserved from the OCR read
          visceral_fat_level: vf == null ? null : Math.round(vf),
          bmr_kcal: bm == null ? null : Math.round(bm),
        });
      } else if (clientId) {
        await addBodyMetric(clientId, {
          measured_at: measured,
          weight_grams: Math.round(w * 1000),
          body_fat_bp: bf == null ? null : Math.round(bf * 100),
          skeletal_muscle_mass_grams: mm == null ? null : Math.round(mm * 1000),
          visceral_fat_level: vf == null ? null : Math.round(vf),
          bmr_kcal: bm == null ? null : Math.round(bm),
        });
      } else {
        setError('Missing client.');
        setBusy(false);
        return;
      }
      router.back();
    } catch {
      setError('Could not save that reading. Please try again.');
      setBusy(false);
    }
  }

  async function onDiscard() {
    if (!metricId) return;
    setError(null);
    setBusy(true);
    try {
      await deleteBodyMetric(metricId);
      router.back();
    } catch {
      setError('Could not discard that reading. Please try again.');
      setBusy(false);
    }
  }

  if (loadingMetric) {
    return (
      <Screen gradient>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120, gap: theme.spacing.md }}
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="h2">{confirmMode ? 'Confirm InBody reading' : 'New InBody reading'}</Text>
          {clientName ? (
            <Text variant="caption" muted>
              For {clientName}
            </Text>
          ) : null}

          {confirmMode && scanMediaId ? (
            <GlassCard padded={false} style={{ overflow: 'hidden' }}>
              <SignedImage mediaId={scanMediaId} style={{ width: '100%', height: 260 }} resizeMode="contain" />
            </GlassCard>
          ) : null}

          <GlassCard style={{ gap: theme.spacing.md }}>
            <Text variant="caption" muted>
              {confirmMode
                ? 'Auto-read from the scan above. Check each value against the sheet and correct anything wrong before confirming. Only weight is required.'
                : 'Enter the values from the client’s InBody sheet. Only weight is required.'}
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

          <Button title={confirmMode ? 'Confirm verified reading' : 'Save verified reading'} onPress={onSave} loading={busy} />
          {confirmMode ? (
            <Button title="Discard scan reading" variant="ghost" onPress={onDiscard} disabled={busy} />
          ) : null}
          <Text variant="caption" muted style={{ textAlign: 'center' }}>
            Saved as coach-verified — this is what progress and ranks read.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// Coach → enter OR review a client's InBody reading (migration 0026 + Phase 12b). The
// coach is the human-in-the-loop (foundations §4): the numbers are stamped coach-verified
// by the DB trigger. Modes:
//   • New reading (no ?metricId) — a blank kg/% form → addBodyMetric (12a).
//   • Review (?metricId) — an OCR-staged reading. The form is pre-filled from the model's
//     read; the coach sees the source scan (tap to zoom) + the richer captured data,
//     confirms/corrects the numbers, can generate a coach-only AI analysis, and leaves
//     comments the client will read. Confirm flips it verified; Discard deletes it.
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import {
  addBodyMetric,
  addMetricComment,
  confirmOcrMetric,
  deleteBodyMetric,
  deleteMetricComment,
  getBodyMetric,
  getMetricInsight,
  listMetricComments,
  type BodyMetricExtras,
  type MetricComment,
  type Segment,
} from '../../src/lib/body-metrics';
import { requestInBodyInsights } from '../../src/lib/inbody-ocr';
import { confirmDestructive } from '../../src/lib/confirm';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Icon, Screen, Text, Input, Button, GlassCard, SignedImage } from '../../src/components/ui';
import { theme } from '../../src/theme';

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function num(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// One label/value line; renders nothing when the value is absent.
function Row({ label, value, unit }: { label: string; value: number | null | undefined; unit?: string }) {
  if (value == null) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md }}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text variant="caption">
        {value}
        {unit ? ` ${unit}` : ''}
      </Text>
    </View>
  );
}

function segText(s?: Segment | null): string | null {
  if (!s) return null;
  const parts = [s.right_arm_kg, s.left_arm_kg, s.trunk_kg, s.right_leg_kg, s.left_leg_kg];
  if (parts.every((p) => p == null)) return null;
  return parts.map((p) => (p == null ? '—' : p)).join(' · ');
}

// The "Additional InBody data" card — read-only context captured by the OCR (segmental,
// history, scores, water ratios). Renders only the fields the sheet actually had.
function ExtrasCard({ extras }: { extras: BodyMetricExtras }) {
  if (!extras) return null;
  const lean = segText(extras.segmental_lean_kg);
  const fat = segText(extras.segmental_fat_kg);
  const history = extras.history?.filter((h) => h.weight_kg != null || h.skeletal_muscle_mass_kg != null || h.body_fat_pct != null) ?? [];
  const hasAny =
    extras.inbody_score != null ||
    extras.fat_free_mass_kg != null ||
    extras.total_body_water_kg != null ||
    extras.ecw_tbw_ratio != null ||
    extras.phase_angle_deg != null ||
    extras.protein_kg != null ||
    extras.minerals_kg != null ||
    extras.target_weight_kg != null ||
    extras.weight_control_kg != null ||
    extras.fat_control_kg != null ||
    extras.muscle_control_kg != null ||
    lean != null ||
    fat != null ||
    history.length > 0 ||
    !!extras.notes;
  if (!hasAny) return null;

  return (
    <GlassCard style={{ gap: theme.spacing.sm }}>
      <Text variant="label" muted>
        Additional InBody data (from the scan)
      </Text>
      <Row label="InBody score" value={extras.inbody_score} />
      <Row label="Fat-free mass" value={extras.fat_free_mass_kg} unit="kg" />
      <Row label="Total body water" value={extras.total_body_water_kg} unit="kg" />
      <Row label="ECW : TBW ratio" value={extras.ecw_tbw_ratio} />
      <Row label="Phase angle" value={extras.phase_angle_deg} unit="°" />
      <Row label="Protein" value={extras.protein_kg} unit="kg" />
      <Row label="Minerals" value={extras.minerals_kg} unit="kg" />
      <Row label="Target weight" value={extras.target_weight_kg} unit="kg" />
      <Row label="Weight control" value={extras.weight_control_kg} unit="kg" />
      <Row label="Fat control" value={extras.fat_control_kg} unit="kg" />
      <Row label="Muscle control" value={extras.muscle_control_kg} unit="kg" />
      {lean ? (
        <View style={{ gap: 2 }}>
          <Text variant="caption" muted>
            Segmental lean (RA·LA·Trunk·RL·LL, kg)
          </Text>
          <Text variant="caption">{lean}</Text>
        </View>
      ) : null}
      {fat ? (
        <View style={{ gap: 2 }}>
          <Text variant="caption" muted>
            Segmental fat (RA·LA·Trunk·RL·LL, kg)
          </Text>
          <Text variant="caption">{fat}</Text>
        </View>
      ) : null}
      {history.length > 0 ? (
        <View style={{ gap: 2, marginTop: theme.spacing.xs }}>
          <Text variant="caption" muted>
            On-sheet history (date · wt · muscle · fat%)
          </Text>
          {history.slice(0, 8).map((h, i) => (
            <Text key={i} variant="caption">
              {h.measured_on ?? '—'} · {h.weight_kg ?? '—'}kg · {h.skeletal_muscle_mass_kg ?? '—'}kg · {h.body_fat_pct ?? '—'}%
            </Text>
          ))}
        </View>
      ) : null}
      {extras.notes ? (
        <Text variant="caption" muted style={{ fontStyle: 'italic' }}>
          {extras.notes}
        </Text>
      ) : null}
    </GlassCard>
  );
}

// Date field: a tappable native date picker on iOS/Android (no more error-prone
// YYYY-MM-DD typing); web keeps a typed field (the native picker has no web support).
// The native module ships with the next dev-client build — until then web works and
// the rest of the screen is unaffected.
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (d: string) => void }) {
  const [show, setShow] = useState(false);
  if (Platform.OS === 'web') {
    return <Input label={label} value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" autoCapitalize="none" />;
  }
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const current = valid ? new Date(`${value}T00:00:00`) : new Date();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" muted>
        {label}
      </Text>
      <Pressable
        onPress={() => setShow(true)}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.surfaceElevated,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 14,
        }}
      >
        <Text variant="body">{valid ? value : 'Select a date'}</Text>
      </Pressable>
      {show ? (
        <DateTimePicker
          value={current}
          mode="date"
          maximumDate={new Date()}
          onChange={(_e, d) => {
            setShow(false);
            if (d) onChange(d.toISOString().slice(0, 10));
          }}
        />
      ) : null}
    </View>
  );
}

export default function BodyMetricScreen() {
  const { role, session } = useAuth();
  const router = useRouter();
  const selfId = session?.user?.id;
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
  const [bodyFatMassGrams, setBodyFatMassGrams] = useState<number | null>(null);
  const [extras, setExtras] = useState<BodyMetricExtras>(null);
  const [scanMediaId, setScanMediaId] = useState<string | null>(null);
  const [loadingMetric, setLoadingMetric] = useState(confirmMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coach-only AI analysis + coach→client comments (review mode only).
  const [insight, setInsight] = useState<string | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightNotice, setInsightNotice] = useState<string | null>(null);
  const [comments, setComments] = useState<MetricComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);

  useEffect(() => {
    if (!metricId) return;
    let active = true;
    (async () => {
      try {
        const [m, ins, cs] = await Promise.all([
          getBodyMetric(metricId),
          getMetricInsight(metricId),
          listMetricComments(metricId),
        ]);
        if (!active) return;
        if (m) {
          setDate(new Date(m.measured_at).toISOString().slice(0, 10));
          setWeight(String(m.weight_grams / 1000));
          if (m.body_fat_bp != null) setBodyFat(String(m.body_fat_bp / 100));
          if (m.skeletal_muscle_mass_grams != null) setMuscle(String(m.skeletal_muscle_mass_grams / 1000));
          if (m.visceral_fat_level != null) setVisceral(String(m.visceral_fat_level));
          if (m.bmr_kcal != null) setBmr(String(m.bmr_kcal));
          setBodyFatMassGrams(m.body_fat_mass_grams);
          setExtras(m.extras);
          setScanMediaId(m.media_id);
        }
        setInsight(ins?.analysis ?? null);
        setComments(cs);
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
          body_fat_mass_grams: bodyFatMassGrams,
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
    const ok = await confirmDestructive(
      'Discard reading?',
      'This permanently deletes this scan reading. This can’t be undone.',
      'Discard',
    );
    if (!ok) return;
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

  async function generateInsight() {
    if (!metricId) return;
    setInsightNotice(null);
    setInsightBusy(true);
    try {
      const r = await requestInBodyInsights(metricId);
      if (r.status === 'analyzed' && r.analysis) setInsight(r.analysis);
      else if (r.status === 'rate_limited') setInsightNotice('AI analysis limit reached for now. Try again shortly.');
      else setInsightNotice('Couldn’t generate an analysis. Please try again.');
    } catch {
      setInsightNotice('Couldn’t generate an analysis. Please try again.');
    } finally {
      setInsightBusy(false);
    }
  }

  async function postComment() {
    if (!metricId || commentText.trim() === '') return;
    setCommentBusy(true);
    try {
      const c = await addMetricComment(metricId, commentText.trim());
      setComments((prev) => [...prev, c]);
      setCommentText('');
    } catch {
      /* keep the text so the coach can retry */
    } finally {
      setCommentBusy(false);
    }
  }

  async function removeComment(id: string) {
    try {
      await deleteMetricComment(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch {
      /* no-op */
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
          <Text variant="h2">{confirmMode ? 'Review InBody reading' : 'New InBody reading'}</Text>
          {clientName ? (
            <Text variant="caption" muted>
              For {clientName}
            </Text>
          ) : null}

          {confirmMode && scanMediaId ? (
            <Pressable
              onPress={() => router.push({ pathname: '/client/progress/view', params: { mediaId: scanMediaId } })}
            >
              <GlassCard padded={false} style={{ overflow: 'hidden' }}>
                <SignedImage mediaId={scanMediaId} style={{ width: '100%', height: 260 }} resizeMode="contain" />
                <View style={{ padding: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs }}>
                  <Icon name="expand-outline" size={14} color={theme.colors.textMuted} />
                  <Text variant="label" muted style={{ fontSize: 10 }}>
                    TAP TO ZOOM
                  </Text>
                </View>
              </GlassCard>
            </Pressable>
          ) : null}

          <GlassCard style={{ gap: theme.spacing.md }}>
            <Text variant="caption" muted>
              {confirmMode
                ? 'Auto-read from the scan above. Check each value against the sheet and correct anything wrong before confirming. Only weight is required.'
                : 'Enter the values from the client’s InBody sheet. Only weight is required.'}
            </Text>

            <DateField label="Test date" value={date} onChange={setDate} />
            <Input label="Weight (kg)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="e.g. 92.5" error={error} />
            <Input label="Body fat (%)" value={bodyFat} onChangeText={setBodyFat} keyboardType="decimal-pad" placeholder="e.g. 25.6" />
            <Input label="Skeletal muscle mass (kg)" value={muscle} onChangeText={setMuscle} keyboardType="decimal-pad" placeholder="e.g. 39.2" />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Input containerStyle={{ flex: 1 }} label="Visceral fat" value={visceral} onChangeText={setVisceral} keyboardType="number-pad" placeholder="level" />
              <Input containerStyle={{ flex: 1 }} label="BMR (kcal)" value={bmr} onChangeText={setBmr} keyboardType="number-pad" placeholder="e.g. 1857" />
            </View>
          </GlassCard>

          {confirmMode ? <ExtrasCard extras={extras} /> : null}

          <Button title={confirmMode ? 'Confirm verified reading' : 'Save verified reading'} onPress={onSave} loading={busy} />
          {confirmMode ? (
            <Button title="Discard scan reading" variant="ghost" onPress={onDiscard} disabled={busy} />
          ) : null}

          {/* Coach-only AI analysis (decision-support; the client never sees it). */}
          {confirmMode ? (
            <GlassCard style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Icon name="sparkles" size={16} color={theme.colors.primary} />
                <Text variant="label" muted style={{ flex: 1 }}>
                  AI analysis (coach only)
                </Text>
              </View>
              {insight ? (
                <Text variant="body" style={{ lineHeight: 22 }}>
                  {insight}
                </Text>
              ) : (
                <Text variant="caption" muted>
                  Generate a goal-relative analysis of this reading and the client’s trend.
                </Text>
              )}
              <Button
                title={insight ? 'Regenerate analysis' : 'Generate AI analysis'}
                variant="secondary"
                fullWidth={false}
                loading={insightBusy}
                onPress={generateInsight}
              />
              {insightNotice ? (
                <Text variant="caption" color="danger">
                  {insightNotice}
                </Text>
              ) : null}
            </GlassCard>
          ) : null}

          {/* Coach → client comments on this reading. */}
          {confirmMode ? (
            <GlassCard style={{ gap: theme.spacing.sm }}>
              <Text variant="label" muted>
                Comments for the client
              </Text>
              {comments.length === 0 ? (
                <Text variant="caption" muted>
                  No comments yet. Leave feedback the client will see on this reading.
                </Text>
              ) : (
                comments.map((c) => (
                  <View key={c.id} style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="body">{c.body}</Text>
                      <Text variant="label" muted style={{ fontSize: 10, marginTop: 2 }}>
                        {new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </Text>
                    </View>
                    {c.author_id === selfId ? (
                      <Pressable onPress={() => removeComment(c.id)} hitSlop={8}>
                        <Icon name="trash-outline" size={16} color={theme.colors.textMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                ))
              )}
              <Input
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Write a comment for the client…"
                multiline
              />
              <Button title="Post comment" fullWidth={false} loading={commentBusy} disabled={commentText.trim() === ''} onPress={postComment} />
            </GlassCard>
          ) : null}

          <Text variant="caption" muted style={{ textAlign: 'center' }}>
            Saved as coach-verified — this is what progress and ranks read.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

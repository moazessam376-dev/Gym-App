// Athlete → log a food into the diary (migration 0019). Pick from the library
// (globals + coach customs, reused from food_library) with a Recent shortcut, or
// quick-add an OFF-PLAN one-off (food_id + plan_meal_item_id null). Enter grams →
// live macro preview → save. The owner is forced server-side; macros are snapshot.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAuth } from '../../src/lib/auth-context';
import { listFoods, type Food } from '../../src/lib/library';
import { addFoodLog, entryMacros, lookupBarcode, recentFoods, todayLocalDate, type FoodLogEntry } from '../../src/lib/nutrition';
import { mealSlotSchema, type MealSlot } from '../../src/schemas/nutrition';
import { BarcodeScannerModal } from '../../src/components/BarcodeScannerModal';
import { Icon, Screen, Text, Input, Button, GlassCard, Segmented, Chip, useToast } from '../../src/components/ui';
import { theme } from '../../src/theme';

function intOr0(s: string): number {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function formatDate(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// A picked food normalised to the snapshot shape the diary stores.
type Picked = {
  food_id: string | null;
  food_name: string;
  kcal_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
  // Serving info (migration 0055) — when present, the picked card offers a "1 serving" chip.
  serving_label?: string | null;
  serving_grams?: number | null;
};

// Tappable date control — native picker on iOS/Android, typed field on web (the
// native module has no web support). Lets a client back-date a log in-screen.
function DateControl({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  if (Platform.OS === 'web') {
    return <Input label={t('food.date')} value={date} onChangeText={onChange} placeholder="YYYY-MM-DD" autoCapitalize="none" />;
  }
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const current = valid ? new Date(`${date}T00:00:00`) : new Date();
  return (
    <>
      <Pressable
        onPress={() => setShow(true)}
        accessibilityRole="button"
        accessibilityLabel={t('food.loggingFor', { date: formatDate(date) })}
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
        <Icon name="calendar" size={18} color={theme.colors.primary} />
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {t('food.loggingFor', { date: formatDate(date) })}
        </Text>
        <Icon name="pencil" size={16} color={theme.colors.textMuted} />
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
    </>
  );
}

export default function AddFood() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const userId = session?.user?.id;
  const params = useLocalSearchParams<{ date?: string; slot?: string }>();
  const initialSlot = mealSlotSchema.safeParse(params.slot).success ? (params.slot as MealSlot) : 'breakfast';

  const [date, setDate] = useState(params.date ?? todayLocalDate());
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [foods, setFoods] = useState<Food[]>([]);
  const [recent, setRecent] = useState<FoodLogEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [grams, setGrams] = useState('100');
  const [busy, setBusy] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanning, setScanning] = useState(false);

  const [cName, setCName] = useState('');
  const [cKcal, setCKcal] = useState('');
  const [cP, setCP] = useState('');
  const [cC, setCC] = useState('');
  const [cF, setCF] = useState('');

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [f, r] = await Promise.all([listFoods(), recentFoods(userId)]);
      setFoods(f);
      setRecent(r);
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? foods.filter((f) => f.name.toLowerCase().includes(q)) : foods;
  }, [foods, query]);

  if (role && role !== 'client') return <Redirect href="/" />;

  const preview = picked ? entryMacros({ ...picked, grams: intOr0(grams) }) : null;

  async function onSave() {
    if (!userId || !picked) return;
    const g = intOr0(grams);
    if (g <= 0) {
      setError(t('food.enterGrams'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addFoodLog(userId, {
        log_date: date,
        meal_slot: slot,
        food_id: picked.food_id,
        food_name: picked.food_name,
        kcal_per_100g: picked.kcal_per_100g,
        protein_g_per_100g: picked.protein_g_per_100g,
        carbs_g_per_100g: picked.carbs_g_per_100g,
        fat_g_per_100g: picked.fat_g_per_100g,
        grams: g,
        serving_label: picked.serving_label ?? null,
        serving_grams: picked.serving_grams ?? null,
      });
      router.back();
    } catch {
      setError(t('food.logError'));
      setBusy(false);
    }
  }

  function pickCustom() {
    setError(null);
    const kcal = intOr0(cKcal);
    if (!cName.trim()) {
      setError(t('food.enterFoodName'));
      return;
    }
    setPicked({
      food_id: null, // off-plan / quick-add one-off
      food_name: cName.trim(),
      kcal_per_100g: kcal,
      protein_g_per_100g: intOr0(cP),
      carbs_g_per_100g: intOr0(cC),
      fat_g_per_100g: intOr0(cF),
    });
    setShowCustom(false);
  }

  async function onScanned(code: string) {
    setScanOpen(false);
    setScanning(true);
    try {
      const res = await lookupBarcode(code);
      if (res.status === 'found') {
        setPicked({
          food_id: null, // a scanned product is logged as a one-off (not a library row)
          food_name: res.food.name,
          kcal_per_100g: res.food.kcal_per_100g,
          protein_g_per_100g: res.food.protein_g_per_100g,
          carbs_g_per_100g: res.food.carbs_g_per_100g,
          fat_g_per_100g: res.food.fat_g_per_100g,
          serving_label: res.food.serving_label,
          serving_grams: res.food.serving_grams,
        });
        setGrams(String(res.food.serving_grams && res.food.serving_grams > 0 ? res.food.serving_grams : 100));
      } else if (res.status === 'not_found') {
        toast.show(t('food.scan.notFound'), 'error');
      } else if (res.status === 'rate_limited') {
        toast.show(t('food.scan.rateLimited'), 'error');
      } else {
        toast.show(t('food.scan.failed'), 'error');
      }
    } finally {
      setScanning(false);
    }
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <FlatList
          data={loading ? [] : filtered}
          keyExtractor={(f) => f.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 140, gap: theme.spacing.sm }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          ListHeaderComponent={
            <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
              <DateControl date={date} onChange={setDate} />
              <Segmented
                options={mealSlotSchema.options.map((s) => ({ label: t(`food.slot.${s}`), value: s }))}
                value={slot}
                onChange={(v) => setSlot(v as MealSlot)}
              />

              {picked ? (
                <GlassCard glowColor={theme.colors.primary} style={{ gap: theme.spacing.md }}>
                  <View>
                    <Text variant="title">{picked.food_name}</Text>
                    <Text variant="caption" color="primary">
                      {t('food.per100g', { kcal: picked.kcal_per_100g, protein: picked.protein_g_per_100g, carbs: picked.carbs_g_per_100g, fat: picked.fat_g_per_100g })}
                    </Text>
                  </View>
                  {picked.serving_grams && picked.serving_grams > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                      <Chip
                        label={t('food.oneServing', { label: picked.serving_label || t('food.serving'), grams: picked.serving_grams })}
                        onPress={() => setGrams(String(picked.serving_grams))}
                      />
                      <Chip label={t('food.gramsChip', { grams: 100 })} onPress={() => setGrams('100')} />
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
                    <Input containerStyle={{ flex: 1 }} label={t('food.grams')} value={grams} onChangeText={setGrams} keyboardType="number-pad" placeholder={t('food.gramsPlaceholder')} />
                    <Button title={t('food.logIt')} fullWidth={false} onPress={onSave} loading={busy} />
                  </View>
                  {preview ? (
                    <Text variant="caption" muted>
                      {t('food.perServing', { kcal: preview.kcal, protein: preview.protein, carbs: preview.carbs, fat: preview.fat })}
                    </Text>
                  ) : null}
                  <Pressable onPress={() => setPicked(null)} accessibilityRole="button" accessibilityLabel={t('food.chooseDifferent')}>
                    <Text variant="caption" color="link">
                      {t('food.chooseDifferent')}
                    </Text>
                  </Pressable>
                </GlassCard>
              ) : (
                <>
                  {recent.length > 0 ? (
                    <View style={{ gap: theme.spacing.sm }}>
                      <Text variant="label" muted>
                        {t('food.recent')}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                        {recent.map((e) => (
                          <Chip
                            key={e.id}
                            label={e.food_name}
                            onPress={() => {
                              setPicked({
                                food_id: e.food_id,
                                food_name: e.food_name,
                                kcal_per_100g: e.kcal_per_100g,
                                protein_g_per_100g: e.protein_g_per_100g,
                                carbs_g_per_100g: e.carbs_g_per_100g,
                                fat_g_per_100g: e.fat_g_per_100g,
                              });
                              setGrams(String(e.grams));
                            }}
                          />
                        ))}
                      </View>
                    </View>
                  ) : null}

                  <Input value={query} onChangeText={setQuery} placeholder={t('food.searchFoods')} />

                  {Platform.OS !== 'web' ? (
                    <Button
                      title={scanning ? t('food.scan.looking') : t('food.scan.cta')}
                      variant="ghost"
                      onPress={() => setScanOpen(true)}
                      loading={scanning}
                      left={<Icon name="camera" size={18} color={theme.colors.primary} />}
                    />
                  ) : null}

                  <Button
                    title={showCustom ? t('common.cancel') : t('food.quickAdd')}
                    variant="ghost"
                    onPress={() => setShowCustom((s) => !s)}
                    left={<Icon name="add-circle-outline" size={18} color={theme.colors.primary} />}
                  />
                  {showCustom ? (
                    <GlassCard style={{ gap: theme.spacing.md }}>
                      <Text variant="caption" muted>
                        {t('food.quickAddIntro')}
                      </Text>
                      <Input value={cName} onChangeText={setCName} placeholder={t('food.foodName')} />
                      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                        <Input containerStyle={{ flex: 1 }} value={cKcal} onChangeText={setCKcal} keyboardType="number-pad" placeholder="kcal" style={{ textAlign: 'center' }} />
                        <Input containerStyle={{ flex: 1 }} value={cP} onChangeText={setCP} keyboardType="number-pad" placeholder="P" style={{ textAlign: 'center' }} />
                        <Input containerStyle={{ flex: 1 }} value={cC} onChangeText={setCC} keyboardType="number-pad" placeholder="C" style={{ textAlign: 'center' }} />
                        <Input containerStyle={{ flex: 1 }} value={cF} onChangeText={setCF} keyboardType="number-pad" placeholder="F" style={{ textAlign: 'center' }} />
                      </View>
                      <Text variant="caption" muted>
                        {t('food.per100gNote')}
                      </Text>
                      <Button title={t('food.useThisFood')} onPress={pickCustom} />
                    </GlassCard>
                  ) : null}
                </>
              )}

              {error ? (
                <Text variant="caption" color="danger">
                  {error}
                </Text>
              ) : null}

              {!picked ? (
                <Text variant="label" muted style={{ marginTop: theme.spacing.xs }}>
                  {t('food.foodLibrary')}
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
            ) : picked ? null : (
              <Text variant="body" muted>
                {t('food.noFoodsFound')}
              </Text>
            )
          }
          renderItem={({ item }) =>
            picked ? null : (
              <GlassCard
                onPress={() => {
                  setPicked({
                    food_id: item.id,
                    food_name: item.name,
                    kcal_per_100g: item.kcal_per_100g,
                    protein_g_per_100g: item.protein_g_per_100g,
                    carbs_g_per_100g: item.carbs_g_per_100g,
                    fat_g_per_100g: item.fat_g_per_100g,
                    serving_label: item.serving_label,
                    serving_grams: item.serving_grams,
                  });
                  if (item.serving_grams && item.serving_grams > 0) setGrams(String(item.serving_grams));
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{item.name}</Text>
                    <Text variant="caption" muted>
                      {t('food.macros', { kcal: item.kcal_per_100g, protein: item.protein_g_per_100g, carbs: item.carbs_g_per_100g, fat: item.fat_g_per_100g })}
                      {item.coach_id ? ` · ${t('food.custom')}` : ''}
                    </Text>
                  </View>
                  <Icon name="add-circle" size={24} color={theme.colors.primary} />
                </View>
              </GlassCard>
            )
          }
        />
      </KeyboardAvoidingView>
      <BarcodeScannerModal visible={scanOpen} onScanned={onScanned} onClose={() => setScanOpen(false)} />
    </Screen>
  );
}

// Coach → pick a food from the library to add to a meal. Searchable + category
// filtered. Surfaces CLIENT FOOD PREFERENCES (migration 0020): each food shows
// avatars of the coach's clients who like it (tap to see names) and a warning for
// clients who avoid it. Filtering by a specific client floats their liked foods to
// the top and flags ones they avoid — so plan-building is fast and personalised.
// Picking a food asks for grams (with a live macro preview); adding a food already
// in the meal MERGES the grams instead of creating a duplicate row.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { createFood, listFoods, type Food } from '../../src/lib/library';
import { foodCategorySchema, type FoodCategory } from '../../src/schemas/library';
import { createMealItem, listMealItems, updateMealItem, type MealItem } from '../../src/lib/plans';
import { listMyClients, type Client } from '../../src/lib/invitations';
import { listClientFoodPreferences } from '../../src/lib/food-preferences';
import { createFoodSchema } from '../../src/schemas/library';
import { Screen, Text, Input, Button, GlassCard, Avatar, Chip, Badge } from '../../src/components/ui';
import { theme } from '../../src/theme';

function intOr0(s: string): number {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
function label(s: string): string {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}
function firstName(c: Client): string {
  return (c.full_name ?? c.invited_email ?? 'Client').split(' ')[0];
}

const CATEGORIES = foodCategorySchema.options;

// food_id -> the coach's clients who like / avoid it.
type PrefIndex = Map<string, { likes: string[]; avoids: string[] }>;

export default function FoodPicker() {
  const { role, session } = useAuth();
  const router = useRouter();
  const { mealId, clientId } = useLocalSearchParams<{ mealId: string; clientId?: string }>();

  const [foods, setFoods] = useState<Food[]>([]);
  const [existing, setExisting] = useState<MealItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [prefIndex, setPrefIndex] = useState<PrefIndex>(new Map());
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<FoodCategory | 'all'>('all');
  // Default the client filter to the plan's client when assigned (empty = template).
  const [clientFilter, setClientFilter] = useState<string | 'all'>(clientId ? clientId : 'all');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Food | null>(null);
  const [grams, setGrams] = useState('100');
  const [busy, setBusy] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cName, setCName] = useState('');
  const [cKcal, setCKcal] = useState('');
  const [cP, setCP] = useState('');
  const [cC, setCC] = useState('');
  const [cF, setCF] = useState('');

  const load = useCallback(async () => {
    try {
      const [f, items, cl, prefs] = await Promise.all([
        listFoods(),
        mealId ? listMealItems(mealId) : Promise.resolve([]),
        listMyClients(),
        listClientFoodPreferences(),
      ]);
      setFoods(f);
      setExisting(items);
      setClients(cl);
      const idx: PrefIndex = new Map();
      for (const p of prefs) {
        const entry = idx.get(p.food_id) ?? { likes: [], avoids: [] };
        (p.kind === 'like' ? entry.likes : entry.avoids).push(p.user_id);
        idx.set(p.food_id, entry);
      }
      setPrefIndex(idx);
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [mealId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, firstName(c));
    return m;
  }, [clients]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = foods.filter(
      (f) => (cat === 'all' || f.category === cat) && (q === '' || f.name.toLowerCase().includes(q)),
    );
    if (clientFilter === 'all') return base;
    // Client selected: liked foods first, avoided last, rest in the middle.
    const rank = (f: Food) => {
      const e = prefIndex.get(f.id);
      if (e?.likes.includes(clientFilter)) return 0;
      if (e?.avoids.includes(clientFilter)) return 2;
      return 1;
    };
    return [...base].sort((a, b) => rank(a) - rank(b));
  }, [foods, query, cat, clientFilter, prefIndex]);

  if (role && role !== 'coach') return <Redirect href="/" />;

  const g = intOr0(grams);
  const preview = selected
    ? {
        kcal: Math.round((selected.kcal_per_100g * g) / 100),
        protein: Math.round((selected.protein_g_per_100g * g) / 100),
        carbs: Math.round((selected.carbs_g_per_100g * g) / 100),
        fat: Math.round((selected.fat_g_per_100g * g) / 100),
      }
    : null;

  async function onAdd() {
    if (!mealId || !selected) return;
    const grm = intOr0(grams);
    if (grm <= 0) {
      setError('Enter grams.');
      return;
    }
    setBusy(true);
    try {
      const dup = existing.find((it) => it.food_id === selected.id);
      if (dup) {
        await updateMealItem(dup.id, { grams: dup.grams + grm });
      } else {
        await createMealItem({
          meal_id: mealId,
          food_id: selected.id,
          food_name: selected.name,
          kcal_per_100g: selected.kcal_per_100g,
          protein_g_per_100g: selected.protein_g_per_100g,
          carbs_g_per_100g: selected.carbs_g_per_100g,
          fat_g_per_100g: selected.fat_g_per_100g,
          grams: grm,
        });
      }
      router.back();
    } catch {
      setError('Could not add that food.');
      setBusy(false);
    }
  }

  async function onCreateCustom() {
    setError(null);
    const parsed = createFoodSchema.safeParse({
      name: cName.trim(),
      kcal_per_100g: intOr0(cKcal),
      protein_g_per_100g: intOr0(cP),
      carbs_g_per_100g: intOr0(cC),
      fat_g_per_100g: intOr0(cF),
      category: cat === 'all' ? null : cat,
    });
    if (!parsed.success) {
      setError('Enter a name and valid macro numbers.');
      return;
    }
    if (!session?.user?.id) return;
    setBusy(true);
    try {
      const created = await createFood(session.user.id, parsed.data);
      setShowCustom(false);
      setSelected(created);
      setCName('');
      setCKcal('');
      setCP('');
      setCC('');
      setCF('');
      await load();
    } catch {
      setError('Could not create the food.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <FlatList
          data={loading ? [] : selected ? [] : filtered}
          keyExtractor={(f) => f.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 140, gap: theme.spacing.sm }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          ListHeaderComponent={
            <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
              {selected ? (
                <GlassCard glowColor={theme.colors.primary} style={{ gap: theme.spacing.md }}>
                  <View>
                    <Text variant="title">{selected.name}</Text>
                    <Text variant="caption" color="primary">
                      {selected.kcal_per_100g} kcal · {selected.protein_g_per_100g}P / {selected.carbs_g_per_100g}C / {selected.fat_g_per_100g}F per 100g
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
                    <Input containerStyle={{ flex: 1 }} label="Grams" value={grams} onChangeText={setGrams} keyboardType="number-pad" placeholder="grams" />
                    <Button
                      title={existing.some((it) => it.food_id === selected.id) ? 'Add more' : 'Add'}
                      fullWidth={false}
                      onPress={onAdd}
                      loading={busy}
                    />
                  </View>
                  {preview ? (
                    <Text variant="bodyStrong" color="primary">
                      This serving: {preview.kcal} kcal · {preview.protein}P / {preview.carbs}C / {preview.fat}F
                    </Text>
                  ) : null}
                  {existing.some((it) => it.food_id === selected.id) ? (
                    <Text variant="caption" muted>
                      Already in this meal — these grams will be added to it.
                    </Text>
                  ) : null}
                  <Pressable onPress={() => setSelected(null)}>
                    <Text variant="caption" color="link">
                      Choose a different food
                    </Text>
                  </Pressable>
                </GlassCard>
              ) : (
                <>
                  <Input value={query} onChangeText={setQuery} placeholder="Search foods" />

                  {/* Category filter */}
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={['all', ...CATEGORIES] as const}
                    keyExtractor={(x) => x}
                    contentContainerStyle={{ gap: theme.spacing.sm }}
                    renderItem={({ item }) => (
                      <Chip
                        label={item === 'all' ? 'All' : label(item)}
                        active={cat === item}
                        onPress={() => setCat(item as FoodCategory | 'all')}
                      />
                    )}
                  />

                  {/* Client filter — float a client's preferred foods to the top */}
                  {clients.length > 0 ? (
                    <View style={{ gap: theme.spacing.xs }}>
                      <Text variant="label" muted>
                        Personalise for
                      </Text>
                      <FlatList
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        data={[{ id: 'all', full_name: 'All clients', invited_email: null } as Client, ...clients]}
                        keyExtractor={(c) => c.id}
                        contentContainerStyle={{ gap: theme.spacing.sm }}
                        renderItem={({ item }) => (
                          <Chip
                            label={item.id === 'all' ? 'All clients' : firstName(item)}
                            active={clientFilter === item.id}
                            onPress={() => setClientFilter(item.id)}
                          />
                        )}
                      />
                    </View>
                  ) : null}

                  <Button
                    title={showCustom ? 'Cancel custom' : 'Create a custom food'}
                    variant="ghost"
                    onPress={() => setShowCustom((s) => !s)}
                  />
                </>
              )}

              {showCustom && !selected ? (
                <GlassCard style={{ gap: theme.spacing.md }}>
                  <Input value={cName} onChangeText={setCName} placeholder="Food name" />
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                    <Input containerStyle={{ flex: 1 }} value={cKcal} onChangeText={setCKcal} keyboardType="number-pad" placeholder="kcal" style={{ textAlign: 'center' }} />
                    <Input containerStyle={{ flex: 1 }} value={cP} onChangeText={setCP} keyboardType="number-pad" placeholder="P" style={{ textAlign: 'center' }} />
                    <Input containerStyle={{ flex: 1 }} value={cC} onChangeText={setCC} keyboardType="number-pad" placeholder="C" style={{ textAlign: 'center' }} />
                    <Input containerStyle={{ flex: 1 }} value={cF} onChangeText={setCF} keyboardType="number-pad" placeholder="F" style={{ textAlign: 'center' }} />
                  </View>
                  <Text variant="caption" muted>
                    Per 100g.{cat !== 'all' ? ` Category: ${label(cat)}.` : ''}
                  </Text>
                  <Button title="Create food" onPress={onCreateCustom} loading={busy} />
                </GlassCard>
              ) : null}
              {error ? (
                <Text variant="caption" color="danger">
                  {error}
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
            ) : selected ? null : (
              <Text variant="body" muted>
                {query.trim() ? 'No foods match your search.' : 'No foods.'}
              </Text>
            )
          }
          renderItem={({ item }) => (
            <FoodRow
              food={item}
              inMeal={existing.some((it) => it.food_id === item.id)}
              pref={prefIndex.get(item.id)}
              nameById={nameById}
              clientFilter={clientFilter}
              onPick={() => setSelected(item)}
            />
          )}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

function FoodRow({
  food,
  inMeal,
  pref,
  nameById,
  clientFilter,
  onPick,
}: {
  food: Food;
  inMeal: boolean;
  pref?: { likes: string[]; avoids: string[] };
  nameById: Map<string, string>;
  clientFilter: string | 'all';
  onPick: () => void;
}) {
  const [showNames, setShowNames] = useState(false);
  // Only show avatars for clients still on the roster (have a name entry).
  const likers = (pref?.likes ?? []).filter((id) => nameById.has(id));
  const avoiders = (pref?.avoids ?? []).filter((id) => nameById.has(id));
  const focusLikes = clientFilter !== 'all' && likers.includes(clientFilter);
  const focusAvoids = clientFilter !== 'all' && avoiders.includes(clientFilter);

  return (
    <GlassCard onPress={onPick} glowColor={focusLikes ? theme.colors.primary : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            <Text variant="bodyStrong">{food.name}</Text>
            {focusLikes ? <Badge label="♥ likes" tone="primary" /> : null}
            {focusAvoids ? <Badge label="avoids" tone="danger" /> : null}
          </View>
          <Text variant="caption" muted>
            {food.kcal_per_100g} kcal · {food.protein_g_per_100g}P / {food.carbs_g_per_100g}C / {food.fat_g_per_100g}F
            {food.coach_id ? ' · custom' : ''}
            {inMeal ? ' · in meal' : ''}
          </Text>

          {/* Liked-by avatars (tap to reveal names) */}
          {likers.length > 0 ? (
            <Pressable
              onPress={() => setShowNames((s) => !s)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginTop: 6 }}
            >
              <Ionicons name="heart" size={13} color={theme.colors.primary} />
              <View style={{ flexDirection: 'row' }}>
                {likers.slice(0, 4).map((id, i) => (
                  <View key={id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                    <Avatar name={nameById.get(id) ?? '?'} size={22} />
                  </View>
                ))}
              </View>
              {showNames ? (
                <Text variant="caption" color="primary" style={{ flexShrink: 1 }}>
                  {likers.map((id) => nameById.get(id)).join(', ')}
                </Text>
              ) : likers.length > 4 ? (
                <Text variant="caption" muted>
                  +{likers.length - 4}
                </Text>
              ) : null}
            </Pressable>
          ) : null}

          {/* Avoid warning when not already focused on that client */}
          {avoiders.length > 0 && !focusAvoids ? (
            <Text variant="caption" color="danger" style={{ marginTop: 4 }}>
              ⊘ {avoiders.map((id) => nameById.get(id)).join(', ')} avoid this
            </Text>
          ) : null}
        </View>
        <Ionicons name="add-circle" size={24} color={theme.colors.primary} />
      </View>
    </GlassCard>
  );
}

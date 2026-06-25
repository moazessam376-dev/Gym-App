// Athlete → mark foods they LIKE or want to AVOID (migration 0020). Their coach
// sees these while building nutrition plans. Search + category filter keep the
// library browsable. Each row toggles like / avoid (tap again to clear). Writes are
// owner-scoped (RLS); the athlete only ever sets their own.
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { listFoods, type Food } from '../../src/lib/library';
import { foodCategorySchema, type FoodCategory } from '../../src/schemas/library';
import {
  getMyFoodPreferences,
  removeFoodPreference,
  setFoodPreference,
} from '../../src/lib/food-preferences';
import type { FoodPrefKind } from '../../src/schemas/food-preference';
import { Icon, Screen, Text, Input, Chip, GlassCard } from '../../src/components/ui';
import { theme } from '../../src/theme';

function label(s: string): string {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

const CATEGORIES = foodCategorySchema.options;

export default function FoodPreferences() {
  const { role, session } = useAuth();
  const userId = session?.user?.id;

  const [foods, setFoods] = useState<Food[]>([]);
  const [prefs, setPrefs] = useState<Map<string, FoodPrefKind>>(new Map());
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<FoodCategory | 'all'>('all');
  const [loading, setLoading] = useState(true);
  // Once the athlete has toggled anything, local state is authoritative — a late
  // server refetch (e.g. the focus reload landing after a fast tap) must NOT
  // overwrite it, or the highlight would flash on then reset.
  const dirtyRef = useRef(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [f, p] = await Promise.all([listFoods(), getMyFoodPreferences(userId)]);
      setFoods(f);
      if (!dirtyRef.current) setPrefs(p);
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
    return foods.filter(
      (f) => (cat === 'all' || f.category === cat) && (q === '' || f.name.toLowerCase().includes(q)),
    );
  }, [foods, query, cat]);

  if (role && role !== 'client') return <Redirect href="/" />;

  async function choose(foodId: string, kind: FoodPrefKind) {
    if (!userId) return;
    dirtyRef.current = true;
    const current = prefs.get(foodId);
    const isClear = current === kind; // tapping the active stance clears it
    // Optimistic update.
    const next = new Map(prefs);
    if (isClear) next.delete(foodId);
    else next.set(foodId, kind);
    setPrefs(next);
    try {
      if (isClear) await removeFoodPreference(userId, foodId);
      else await setFoodPreference(userId, foodId, kind);
    } catch {
      // Revert ONLY this food to its previous stance — never reload the whole
      // map (that's what made every toggle flash and reset).
      setPrefs((p) => {
        const n = new Map(p);
        if (current === undefined) n.delete(foodId);
        else n.set(foodId, current);
        return n;
      });
    }
  }

  const likeCount = [...prefs.values()].filter((k) => k === 'like').length;
  const avoidCount = [...prefs.values()].filter((k) => k === 'avoid').length;

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
              <View>
                <Text variant="h1">Food preferences</Text>
                <Text variant="body" muted>
                  Mark foods you love or want to avoid. Your coach sees these when building your plan.
                </Text>
                {likeCount + avoidCount > 0 ? (
                  <Text variant="caption" color="primary" style={{ marginTop: 4 }}>
                    {likeCount} liked · {avoidCount} avoided
                  </Text>
                ) : null}
              </View>
              <Input value={query} onChangeText={setQuery} placeholder="Search foods" />
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={['all', ...CATEGORIES] as const}
                keyExtractor={(c) => c}
                contentContainerStyle={{ gap: theme.spacing.sm }}
                renderItem={({ item }) => (
                  <Chip
                    label={item === 'all' ? 'All' : label(item)}
                    active={cat === item}
                    onPress={() => setCat(item as FoodCategory | 'all')}
                  />
                )}
              />
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
            ) : (
              <Text variant="body" muted>
                No foods match.
              </Text>
            )
          }
          renderItem={({ item }) => {
            const stance = prefs.get(item.id);
            return (
              <GlassCard glowColor={stance === 'like' ? theme.colors.primary : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{item.name}</Text>
                    <Text variant="caption" muted>
                      {item.kcal_per_100g} kcal · {item.protein_g_per_100g}P / {item.carbs_g_per_100g}C / {item.fat_g_per_100g}F
                    </Text>
                  </View>
                  <PrefToggle
                    icon="heart"
                    active={stance === 'like'}
                    activeColor={theme.colors.primary}
                    onPress={() => choose(item.id, 'like')}
                  />
                  <PrefToggle
                    icon="ban"
                    active={stance === 'avoid'}
                    activeColor={theme.colors.danger}
                    onPress={() => choose(item.id, 'avoid')}
                  />
                </View>
              </GlassCard>
            );
          }}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

function PrefToggle({
  icon,
  active,
  activeColor,
  onPress,
}: {
  icon: 'heart' | 'ban';
  active: boolean;
  activeColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={{
        width: 40,
        height: 40,
        borderRadius: theme.radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: active ? activeColor : theme.colors.glassBorder,
        backgroundColor: active ? `${activeColor}22` : theme.colors.glass,
      }}
    >
      <Icon
        name={active ? icon : (`${icon}-outline` as 'heart-outline' | 'ban-outline')}
        size={20}
        color={active ? activeColor : theme.colors.textMuted}
      />
    </Pressable>
  );
}

// TrophyGrid (Engagement E1/E2) — renders a user's earned system-minted trophies as a
// wrapping grid of tinted tiles. Used on the athlete + coach public profiles. The DB stores
// only achievement_keys; the catalog (src/lib/achievements.ts) supplies icon/title/rarity.
// Module-scope component → its OWN useTranslation (CLAUDE.md §13 / i18n rule).
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { theme } from '@/theme';
import { Icon, Text } from '@/components/ui';
import { textStart } from '@/lib/rtl';
import { ACHIEVEMENT_BY_KEY, type EarnedAchievement } from '@/lib/achievements';

export function TrophyGrid({ earned }: { earned: EarnedAchievement[] }) {
  const { t } = useTranslation();
  const known = earned
    .map((e) => ({ e, def: ACHIEVEMENT_BY_KEY[e.achievement_key] }))
    .filter((x): x is { e: EarnedAchievement; def: NonNullable<typeof x.def> } => !!x.def);

  if (known.length === 0) return null;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="label" muted style={textStart}>
        {t('achievements.title')} · {known.length}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {known.map(({ e, def }) => {
          const color = theme.tier[def.rarity];
          return (
            <View
              key={e.achievement_key}
              style={{
                width: '31%',
                minWidth: 96,
                flexGrow: 1,
                alignItems: 'center',
                gap: 6,
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.sm,
                borderRadius: theme.radii.md,
                backgroundColor: theme.colors.glass,
                borderWidth: 1,
                borderColor: theme.colors.glassBorder,
              }}
            >
              <Icon name={def.icon} size={24} color={color} />
              <Text variant="caption" align="center" numberOfLines={2}>
                {t(def.titleKey)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

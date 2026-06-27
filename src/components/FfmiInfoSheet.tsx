// An info sheet explaining the physique league (Slice G1). FFMI is an unfamiliar metric,
// so the leaderboard offers a tap-to-learn sheet: what FFMI measures, why it needs a
// coach-verified InBody, and the Bronze→Apex tier ladder. Presentational only — the parent
// owns visibility. Follows the app's Modal bottom-sheet pattern (see ReportMessageSheet).
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TIERS } from '../lib/leagues';
import { Icon, Text, TierChip } from './ui';
import { textStart } from '../lib/rtl';
import { theme } from '../theme';

export function FfmiInfoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        {/* Stop propagation so taps inside the sheet don't dismiss it. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.colors.surfaceElevated,
            borderTopLeftRadius: theme.radii.xl,
            borderTopRightRadius: theme.radii.xl,
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.lg,
            paddingBottom: theme.spacing.xxl,
            gap: theme.spacing.md,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
            maxHeight: '80%',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Icon name="sparkles" size={20} color={theme.colors.primary} />
            <Text variant="title" style={{ flex: 1 }}>
              {t('leaderboards.ffmiInfo.title')}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <Icon name="close" size={22} color={theme.colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ gap: theme.spacing.md }} showsVerticalScrollIndicator={false}>
            <Text variant="body" muted style={textStart}>
              {t('leaderboards.ffmiInfo.what')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}>
              <Icon name="check-circle" size={18} color={theme.colors.success} />
              <Text variant="caption" muted style={[textStart, { flex: 1 }]}>
                {t('leaderboards.ffmiInfo.verified')}
              </Text>
            </View>

            <Text variant="label" muted style={[textStart, { marginTop: theme.spacing.sm }]}>
              {t('leaderboards.ffmiInfo.tiersTitle')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {TIERS.map((tier) => (
                <TierChip key={tier} tier={tier} label={t(`leaderboards.tier.${tier}`)} />
              ))}
            </View>
            <Text variant="caption" muted style={textStart}>
              {t('leaderboards.ffmiInfo.tiersNote')}
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

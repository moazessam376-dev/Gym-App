// Admin console home (Slice G3). A live dashboard — pending applications, open reports +
// appeals, coach/client totals, recent signups (all from the admin-gated admin_dashboard_counts
// RPC, 0054) — plus navigation to the three review surfaces (Applications, Reports, Users).
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAdminCounts } from '@/lib/queries/admin';
import { Icon, type IconName, Screen, Text, Card, KpiTile, type KpiTone } from '@/components/ui';
import { theme } from '@/theme';

function NavCard({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  return (
    <Card onPress={onPress} elevated>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.surfaceElevated,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={22} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="title">{title}</Text>
          <Text variant="caption" muted>
            {sub}
          </Text>
        </View>
        <Icon name="chevron-forward" size={20} color={theme.colors.textMuted} />
      </View>
    </Card>
  );
}

export default function AdminHome() {
  const { t } = useTranslation();
  const router = useRouter();
  const countsQ = useAdminCounts();
  const c = countsQ.data;

  const go = (href: Href) => () => router.push(href);

  // Each tile: value · label · tone · optional tap target.
  const tiles: { key: string; value: number; label: string; tone: KpiTone; icon: IconName; href?: Href }[] = [
    { key: 'pendingApps', value: c?.pending_applications ?? 0, label: t('admin.counts.pendingApps'), tone: (c?.pending_applications ?? 0) > 0 ? 'warning' : 'neutral', icon: 'clipboard', href: '/admin/applications' },
    { key: 'openReports', value: c?.open_reports ?? 0, label: t('admin.counts.openReports'), tone: (c?.open_reports ?? 0) > 0 ? 'warning' : 'neutral', icon: 'flag', href: '/admin/reports' },
    { key: 'openAppeals', value: c?.open_appeals ?? 0, label: t('admin.counts.openAppeals'), tone: (c?.open_appeals ?? 0) > 0 ? 'warning' : 'neutral', icon: 'mail', href: '/admin/reports' },
    { key: 'coaches', value: c?.coaches ?? 0, label: t('admin.counts.coaches'), tone: 'neutral', icon: 'users' },
    { key: 'clients', value: c?.clients ?? 0, label: t('admin.counts.clients'), tone: 'neutral', icon: 'user' },
    { key: 'signups7d', value: c?.signups_7d ?? 0, label: t('admin.counts.signups7d'), tone: 'primary', icon: 'trending-up' },
  ];

  return (
    <Screen scroll contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
      <View>
        <Text variant="caption" muted>
          {t('admin.console')}
        </Text>
        <Text variant="h1">{t('admin.platform')}</Text>
      </View>

      {/* Live counts (admin-gated RPC) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
        {tiles.map((tile) => (
          <KpiTile
            key={tile.key}
            value={String(tile.value).padStart(2, '0')}
            label={tile.label}
            tone={tile.tone}
            icon={tile.icon}
            onPress={tile.href ? go(tile.href) : undefined}
            style={{ flex: 0, flexBasis: '47%', flexGrow: 1 }}
          />
        ))}
      </View>

      {/* Review surfaces */}
      <View style={{ gap: theme.spacing.md }}>
        <NavCard
          icon="clipboard"
          title={t('admin.coachApplications')}
          sub={t('admin.coachApplicationsSub')}
          onPress={go('/admin/applications')}
        />
        <NavCard
          icon="flag"
          title={t('admin.reports')}
          sub={t('admin.reportsSub')}
          onPress={go('/admin/reports')}
        />
        <NavCard
          icon="search"
          title={t('admin.users')}
          sub={t('admin.usersSub')}
          onPress={go('/admin/users')}
        />
      </View>
    </Screen>
  );
}

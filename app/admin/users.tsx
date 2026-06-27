// Admin → user search + ban/unban (Slice G3). Search profiles by name (admin-gated RPC),
// then ban / unban any non-admin from the result row. Ban blocks SENDING only, not access
// (Phase 18). Admin-only; others redirect.
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { textStart } from '../../src/lib/rtl';
import { confirmDestructive } from '../../src/lib/confirm';
import { queryClient } from '../../src/lib/query';
import { setUserBan, type AdminUser } from '../../src/lib/admin';
import { useUserSearch } from '../../src/lib/queries/admin';
import { Screen, Text, Input, Card, Avatar, Badge, Button, EmptyState, useToast } from '../../src/components/ui';
import { theme } from '../../src/theme';

function UserRow({ user, busy, onToggleBan }: { user: AdminUser; busy: boolean; onToggleBan: () => void }) {
  const { t } = useTranslation();
  const banned = user.banned_at != null;
  const isAdmin = user.role === 'admin';
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Avatar name={user.full_name ?? '?'} size={40} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title" style={textStart} numberOfLines={1}>
            {user.full_name ?? t('admin.noName')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Badge label={t(`roles.${user.role}`)} tone={user.role === 'coach' ? 'primary' : 'neutral'} />
            {banned ? <Badge label={t('admin.banned')} tone="danger" /> : null}
          </View>
        </View>
        {!isAdmin ? (
          <Button
            title={banned ? t('admin.unban') : t('admin.ban')}
            variant={banned ? 'secondary' : 'danger'}
            onPress={onToggleBan}
            loading={busy}
          />
        ) : null}
      </View>
    </Card>
  );
}

export default function AdminUsersScreen() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const usersQ = useUserSearch(query, role === 'admin');

  if (role && role !== 'admin') return <Redirect href="/" />;

  const users = usersQ.data ?? [];

  const onToggleBan = (user: AdminUser) => async () => {
    const banning = user.banned_at == null;
    const name = user.full_name ?? t('admin.noName');
    const ok = await confirmDestructive(
      banning ? t('admin.banConfirmTitle') : t('admin.unbanConfirmTitle'),
      banning ? t('admin.banConfirmMsg', { name }) : t('admin.unbanConfirmMsg', { name }),
      banning ? t('admin.ban') : t('admin.unban'),
    );
    if (!ok) return;
    setBusyId(user.id);
    try {
      await setUserBan(user.id, banning);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-counts'] }),
      ]);
      toast.show(banning ? t('admin.bannedToast') : t('admin.unbannedToast'));
    } catch {
      toast.show(t('common.error'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen padded={false} gradient>
      <Stack.Screen options={{ title: t('admin.users') }} />
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, gap: theme.spacing.sm }}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder={t('admin.searchPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        ListEmptyComponent={
          usersQ.isPending ? null : (
            <EmptyState
              icon="search"
              title={query.trim().length >= 2 ? t('admin.noUsers') : t('admin.searchHint')}
              subtitle={query.trim().length >= 2 ? t('admin.noUsersSub') : t('admin.searchHintSub')}
            />
          )
        }
        renderItem={({ item }) => (
          <UserRow user={item} busy={busyId === item.id} onToggleBan={onToggleBan(item)} />
        )}
      />
    </Screen>
  );
}

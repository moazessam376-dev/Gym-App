// Messages tab — a real conversation list (not just a roster). Each row shows the
// last message, a compact timestamp, an unread badge, and a voice/note hint, sorted
// by recency — so the Chat tab reads as "conversations" and is visually distinct from
// the Clients tab. Powered by list_conversation_previews (0058, one round-trip); pairs
// with no messages yet still appear (so a new client/coach isn't hidden). Tapping opens
// the thread (app/chat/[id]); opening it clears the unread badge (mark_conversation_read).
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { useConversationPreviews, useMyClients, useMyCoach, useRefreshOnFocus } from '../../src/lib/queries/home';
import { compactTimeParts } from '../../src/lib/notifications';
import type { ConversationPreview } from '../../src/lib/messages';
import { textStart } from '../../src/lib/rtl';
import { ProfileAvatar } from '../../src/components/ProfileAvatar';
import { Icon, Screen, Text, GlassCard, EmptyState, Badge } from '../../src/components/ui';
import { theme } from '../../src/theme';

type Row = {
  peerId: string;
  name: string;
  preview: ConversationPreview | null; // null = no messages exchanged yet
};

export default function MessagesTab() {
  const { t } = useTranslation();
  const { session, role } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  const previewsQ = useConversationPreviews();
  const clientsQ = useMyClients();
  const coachQ = useMyCoach(role === 'client' ? userId : undefined);
  useRefreshOnFocus(() => {
    previewsQ.refetch();
    if (role === 'coach') clientsQ.refetch();
    else coachQ.refetch();
  });

  const [query, setQuery] = useState('');

  const rows: Row[] = useMemo(() => {
    const byPeer = new Map((previewsQ.data ?? []).map((p) => [p.peer_id, p]));
    // The roster of people this user can converse with (so message-less pairs show too).
    const people: { id: string; name: string }[] =
      role === 'coach'
        ? (clientsQ.data ?? []).map((c) => ({ id: c.id, name: c.full_name ?? c.invited_email ?? t('messages.client') }))
        : role === 'client' && coachQ.data
          ? [{ id: coachQ.data.id, name: coachQ.data.full_name ?? t('home.yourCoach') }]
          : [];
    const list: Row[] = people.map((p) => ({ peerId: p.id, name: p.name, preview: byPeer.get(p.id) ?? null }));
    // Recency sort: conversations with messages first (newest on top), then the rest.
    list.sort((a, b) => {
      const ta = a.preview ? new Date(a.preview.last_at).getTime() : 0;
      const tb = b.preview ? new Date(b.preview.last_at).getTime() : 0;
      return tb - ta;
    });
    const q = query.trim().toLowerCase();
    return q ? list.filter((r) => r.name.toLowerCase().includes(q)) : list;
  }, [previewsQ.data, clientsQ.data, coachQ.data, role, query, t]);

  const loading = role === 'coach' ? clientsQ.isPending : coachQ.isPending;
  const load = () => {
    previewsQ.refetch();
    if (role === 'coach') clientsQ.refetch();
    else coachQ.refetch();
  };

  // The single-line preview text (You:/voice/note aware). Empty body + voice → a label.
  const previewText = (p: ConversationPreview | null): string => {
    if (!p) return t('messages.noMessagesYet');
    const me = p.last_from_me ? `${t('chat.you')} ` : '';
    if (p.is_voice) return `${me}${t('chat.voiceMessage')}`;
    if (p.is_note) return `${me}${t('chat.noteMessage')}`;
    return `${me}${p.last_body}`;
  };

  const header = (
    <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radii.lg,
          paddingHorizontal: theme.spacing.md,
          height: 44,
        }}
      >
        <Icon name="search" size={18} color={theme.colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('chat.searchPlaceholder')}
          placeholderTextColor={theme.colors.textMuted}
          style={[{ flex: 1, color: theme.colors.text, fontSize: 15 }, textStart]}
          returnKeyType="search"
        />
      </View>
      <Text variant="label" muted style={textStart}>
        {role === 'coach' ? t('chat.sectionClients') : t('chat.sectionCoach')}
      </Text>
    </View>
  );

  return (
    <Screen padded={false} gradient>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
        <Text variant="h1" style={textStart}>
          {t('messages.title')}
        </Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.peerId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        ListHeaderComponent={loading && rows.length === 0 ? null : header}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.colors.primary} />}
        ListEmptyComponent={
          loading ? null : role === 'client' ? (
            <EmptyState
              icon="chatbubbles-outline"
              title={t('messages.noCoachTitle')}
              subtitle={t('messages.noCoachSub')}
              actionLabel={t('home.acceptInvite')}
              onAction={() => router.push('/accept-invite')}
            />
          ) : (
            <EmptyState icon="chatbubbles-outline" title={t('messages.noClientsTitle')} subtitle={t('messages.noClientsSub')} />
          )
        }
        renderItem={({ item }) => {
          const p = item.preview;
          const unread = p?.unread_count ?? 0;
          const tparts = p ? compactTimeParts(p.last_at) : null;
          return (
            <GlassCard onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.peerId, name: item.name } })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <ProfileAvatar name={item.name} avatarMediaId={p?.avatar_media_id ?? null} size={46} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Text variant="title" numberOfLines={1} style={[textStart, { flex: 1 }]}>
                      {item.name}
                    </Text>
                    {tparts ? (
                      <Text variant="caption" muted>
                        {t(tparts.key, { count: tparts.count })}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {p?.is_voice ? <Icon name="mic" size={13} color={theme.colors.primary} /> : null}
                    <Text
                      variant="caption"
                      muted
                      numberOfLines={1}
                      style={[textStart, { flex: 1, fontWeight: unread > 0 ? '600' : '400' }]}
                    >
                      {previewText(p)}
                    </Text>
                    {unread > 0 ? <Badge label={unread > 9 ? '9+' : String(unread)} tone="primary" solid /> : null}
                  </View>
                </View>
              </View>
            </GlassCard>
          );
        }}
      />
    </Screen>
  );
}

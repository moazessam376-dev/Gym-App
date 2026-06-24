// Chat thread with one counterpart (coach↔client). Messages backend is live
// (migration 0012): RLS limits rows to the two parties, the DB trigger sets
// sender_id, and realtime delivers incoming messages. Newest-at-bottom via an
// inverted list; pull up (onEndReached) loads older history by cursor.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useHeaderHeight } from '@react-navigation/elements';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/lib/auth-context';
import {
  CONVERSATION_PAGE_SIZE,
  listConversation,
  sendMessage,
  subscribeToIncoming,
  type Message,
} from '../../src/lib/messages';
import { reportMessage } from '../../src/lib/moderation';
import type { ReportReason } from '../../src/schemas/moderation';
import { ReportMessageSheet } from '../../src/components/ReportMessageSheet';
import { Screen, Text } from '../../src/components/ui';
import { theme } from '../../src/theme';

function Bubble({
  mine,
  body,
  at,
  onLongPress,
}: {
  mine: boolean;
  body: string;
  at: string;
  onLongPress?: () => void;
}) {
  const time = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginVertical: 3 }}>
      {/* Long-press an incoming message to report it (Phase 18 safety). */}
      <Pressable
        onLongPress={onLongPress}
        disabled={!onLongPress}
        delayLongPress={300}
        style={{
          maxWidth: '82%',
          backgroundColor: mine ? theme.colors.primary : theme.colors.glass,
          borderWidth: mine ? 0 : 1,
          borderColor: theme.colors.glassBorder,
          borderRadius: theme.radii.lg,
          borderBottomRightRadius: mine ? 4 : theme.radii.lg,
          borderBottomLeftRadius: mine ? theme.radii.lg : 4,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
        }}
      >
        <Text variant="body" color={mine ? theme.colors.onPrimary : theme.colors.text}>
          {body}
        </Text>
      </Pressable>
      <Text variant="caption" muted style={{ fontSize: 10, marginTop: 2, marginHorizontal: 4 }}>
        {time}
      </Text>
    </View>
  );
}

export default function ChatThread() {
  const { id: otherId, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { t } = useTranslation();
  const { session } = useAuth();
  const myId = session?.user?.id;
  // Measured header height → exact keyboard offset (the hardcoded 90 clipped).
  const headerHeight = useHeaderHeight();

  // Report flow (Phase 18 safety): which incoming message is being reported.
  const [reportId, setReportId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  async function submitReport(reason: ReportReason) {
    const id = reportId;
    setReportId(null); // close the sheet immediately
    if (!id) return;
    setReporting(true);
    try {
      await reportMessage({ message_id: id, reason });
      Alert.alert(t('report.thanksTitle'), t('report.thanksBody'));
    } catch {
      Alert.alert(t('report.failTitle'), t('report.failBody'));
    } finally {
      setReporting(false);
    }
  }

  // Stored newest-first to feed an inverted FlatList (index 0 renders at bottom).
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Initial page.
  useEffect(() => {
    if (!myId || !otherId) return;
    let active = true;
    (async () => {
      try {
        const page = await listConversation(myId, otherId); // oldest-first
        if (active) {
          setMessages([...page].reverse()); // → newest-first
          setHasMore(page.length === CONVERSATION_PAGE_SIZE);
        }
      } catch {
        /* keep empty */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [myId, otherId]);

  // Realtime: append incoming messages from this counterpart.
  useEffect(() => {
    if (!myId || !otherId) return;
    const channel = subscribeToIncoming(myId, (m) => {
      if (m.sender_id === otherId) setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [m, ...prev]));
    });
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [myId, otherId]);

  const loadOlder = useCallback(async () => {
    if (!myId || !otherId || loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[messages.length - 1]!;
      const page = await listConversation(myId, otherId, { before: oldest.created_at }); // oldest-first
      setMessages((prev) => [...prev, ...[...page].reverse()]); // append older to the end
      setHasMore(page.length === CONVERSATION_PAGE_SIZE);
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }, [myId, otherId, loadingMore, hasMore, messages]);

  async function onSend() {
    const body = input.trim();
    if (!body || !otherId || sending) return;
    setInput('');
    setSending(true);
    try {
      const sent = await sendMessage({ recipient_id: otherId, body });
      setMessages((prev) => (prev.some((x) => x.id === sent.id) ? prev : [sent, ...prev]));
    } catch {
      setInput(body); // restore on failure
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: name ?? 'Chat' }} />
      <Screen gradient padded={false} edges={['bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
        >
          {loading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <FlatList
              data={messages}
              inverted
              keyExtractor={(m) => m.id}
              contentContainerStyle={{ padding: theme.spacing.lg }}
              keyboardDismissMode="interactive"
              onEndReached={loadOlder}
              onEndReachedThreshold={0.3}
              ListFooterComponent={
                loadingMore ? <ActivityIndicator color={theme.colors.textMuted} style={{ marginVertical: 12 }} /> : null
              }
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: theme.spacing.xxl }}>
                  <Text variant="body" muted align="center">
                    No messages yet. Say hello 👋
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <Bubble
                  mine={item.sender_id === myId}
                  body={item.body}
                  at={item.created_at}
                  onLongPress={item.sender_id !== myId ? () => setReportId(item.id) : undefined}
                />
              )}
            />
          )}

          {/* Composer */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: theme.spacing.sm,
              padding: theme.spacing.md,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              backgroundColor: theme.colors.bg,
            }}
          >
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Message…"
              placeholderTextColor={theme.colors.textMuted}
              multiline
              maxLength={4000}
              style={{
                flex: 1,
                maxHeight: 120,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.lg,
                paddingHorizontal: theme.spacing.lg,
                paddingTop: theme.spacing.md,
                paddingBottom: theme.spacing.md,
                color: theme.colors.text,
                fontFamily: theme.fontFamily.bodyRegular,
                fontSize: 15,
              }}
            />
            <Pressable
              onPress={onSend}
              disabled={sending || input.trim().length === 0}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: input.trim().length === 0 ? theme.colors.surfaceElevated : theme.colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name="send"
                size={18}
                color={input.trim().length === 0 ? theme.colors.textMuted : theme.colors.onPrimary}
              />
            </Pressable>
          </View>
        </KeyboardAvoidingView>

        <ReportMessageSheet
          visible={reportId !== null}
          busy={reporting}
          onPick={submitReport}
          onClose={() => setReportId(null)}
        />
      </Screen>
    </>
  );
}

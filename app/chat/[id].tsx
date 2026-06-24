// Chat thread with one counterpart (coach↔client). Messages backend is live
// (migration 0012): RLS limits rows to the two parties, the DB trigger sets
// sender_id, and realtime delivers incoming messages. Newest-at-bottom via an
// inverted list; pull up (onEndReached) loads older history by cursor.
//
// Phase 18 Slice 2 layers on engagement + the banned-user UX: day dividers,
// emoji reactions (long-press a bubble), soft edit of your own recent message, and
// a "you're blocked" notice in place of the composer when your account is banned.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming, ZoomIn } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useHeaderHeight } from '@react-navigation/elements';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/lib/auth-context';
import {
  CONVERSATION_PAGE_SIZE,
  addReaction,
  editMessage,
  listConversation,
  listReactions,
  removeReaction,
  sendMessage,
  subscribeToIncoming,
  subscribeToReactions,
  type Message,
  type Reaction,
  type ReplyPreview,
} from '../../src/lib/messages';
import {
  acknowledgeChatTerms,
  fetchChatAcknowledged,
  fetchMyBanState,
  fetchMyOpenAppeal,
  reportMessage,
  submitBanAppeal,
} from '../../src/lib/moderation';
import { REACTION_EMOJIS, type ReactionEmoji } from '../../src/schemas/message';
import type { ReportReason } from '../../src/schemas/moderation';
import { ReportMessageSheet } from '../../src/components/ReportMessageSheet';
import { BanAppealSheet } from '../../src/components/BanAppealSheet';
import { MessageActionsSheet } from '../../src/components/MessageActionsSheet';
import { Emoji } from '../../src/components/Emoji';
import { Screen, Text, Button } from '../../src/components/ui';
import { theme } from '../../src/theme';

const EDIT_WINDOW_MS = 15 * 60 * 1000; // mirrors the 0036 server-side edit window

const errIs = (err: unknown, code: string) =>
  typeof (err as { message?: unknown })?.message === 'string' &&
  (err as { message: string }).message.includes(code);

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

type ReactionMap = Record<string, Reaction[]>;

// Reactions keyed by message; helpers keep updates idempotent (realtime can echo
// our own optimistic change back to us).
function addToMap(map: ReactionMap, r: Reaction): ReactionMap {
  const list = map[r.message_id] ?? [];
  if (list.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)) return map;
  return { ...map, [r.message_id]: [...list, r] };
}
function removeFromMap(map: ReactionMap, r: Reaction): ReactionMap {
  const list = map[r.message_id];
  if (!list) return map;
  return { ...map, [r.message_id]: list.filter((x) => !(x.user_id === r.user_id && x.emoji === r.emoji)) };
}

function ReactionChips({
  reactions,
  myId,
  mine,
  onToggle,
}: {
  reactions: Reaction[];
  myId: string;
  mine: boolean;
  onToggle: (emoji: ReactionEmoji) => void;
}) {
  // Count per emoji + whether I'm among the reactors, preserving the allowlist order.
  const groups = REACTION_EMOJIS.map((emoji) => {
    const forEmoji = reactions.filter((r) => r.emoji === emoji);
    return { emoji, count: forEmoji.length, mineReacted: forEmoji.some((r) => r.user_id === myId) };
  }).filter((g) => g.count > 0);
  if (groups.length === 0) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 4,
        marginHorizontal: 4,
        justifyContent: mine ? 'flex-end' : 'flex-start',
      }}
    >
      {groups.map((g) => (
        <Animated.View key={g.emoji} entering={ZoomIn.duration(220)}>
          <Pressable
            onPress={() => onToggle(g.emoji)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: theme.radii.full,
              backgroundColor: g.mineReacted ? theme.colors.primary : theme.colors.glass,
              borderWidth: 1,
              borderColor: g.mineReacted ? theme.colors.primary : theme.colors.glassBorder,
            }}
          >
            <Emoji char={g.emoji} size={14} />
            <Text
              variant="caption"
              color={g.mineReacted ? theme.colors.onPrimary : theme.colors.textMuted}
              style={{ fontSize: 11 }}
            >
              {g.count}
            </Text>
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );
}

function QuoteBox({
  reply,
  mine,
  authorLabel,
}: {
  reply: ReplyPreview;
  mine: boolean;
  authorLabel: string;
}) {
  return (
    <View
      style={{
        borderLeftWidth: 3,
        borderLeftColor: mine ? 'rgba(255,255,255,0.7)' : theme.colors.primary,
        backgroundColor: mine ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.05)',
        borderRadius: theme.radii.sm,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 4,
        marginBottom: 6,
      }}
    >
      <Text variant="caption" color={mine ? theme.colors.onPrimary : theme.colors.primary} style={{ fontSize: 11 }}>
        {authorLabel}
      </Text>
      <Text
        variant="caption"
        numberOfLines={1}
        color={mine ? theme.colors.onPrimary : theme.colors.textMuted}
        style={{ fontSize: 12, opacity: 0.85 }}
      >
        {reply.body}
      </Text>
    </View>
  );
}

function Bubble({
  mine,
  body,
  at,
  edited,
  reply,
  counterpartName,
  reactions,
  myId,
  onLongPress,
  onToggleReaction,
  onDoubleTap,
  onReply,
}: {
  mine: boolean;
  body: string;
  at: string;
  edited: boolean;
  reply: ReplyPreview | null;
  counterpartName: string;
  reactions: Reaction[];
  myId: string;
  onLongPress: () => void;
  onToggleReaction: (emoji: ReactionEmoji) => void;
  /** Double-tap the bubble to ❤️ it (Instagram/Telegram-style). Omitted ⇒ disabled. */
  onDoubleTap?: () => void;
  /** Swipe the bubble right to reply. Omitted ⇒ disabled (e.g. banned). */
  onReply?: () => void;
}) {
  const { t } = useTranslation();
  const time = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  // Double-tap detection + a transient heart "burst" over the bubble.
  const lastTap = useRef(0);
  const burst = useSharedValue(0);
  const burstStyle = useAnimatedStyle(() => ({
    opacity: burst.value,
    transform: [{ scale: 0.4 + burst.value }],
  }));
  function handlePress() {
    if (!onDoubleTap) return;
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      burst.value = withSequence(withTiming(1, { duration: 140 }), withTiming(0, { duration: 420 }));
      onDoubleTap();
    } else {
      lastTap.current = now;
    }
  }

  // Swipe-right-to-reply (PanResponder — no extra native dep, works in Expo Go + web).
  // Only claims clearly-horizontal drags so vertical scroll + taps still work.
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const translateX = useSharedValue(0);
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const arrowStyle = useAnimatedStyle(() => {
    const p = Math.min(translateX.value / 46, 1);
    return { opacity: p, transform: [{ scale: 0.6 + p * 0.4 }] };
  });
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !!onReplyRef.current && g.dx > 12 && g.dx > Math.abs(g.dy) * 1.6,
      onPanResponderMove: (_, g) => {
        translateX.value = Math.min(Math.max(g.dx, 0), 72);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx > 46) onReplyRef.current?.();
        translateX.value = withTiming(0, { duration: 160 });
      },
      onPanResponderTerminate: () => {
        translateX.value = withTiming(0, { duration: 160 });
      },
    }),
  ).current;

  const authorLabel = reply ? (reply.sender_id === myId ? t('chat.you') : counterpartName) : '';

  return (
    <View style={{ marginVertical: 3 }}>
      {/* Reply affordance revealed under the bubble as you swipe right. */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', left: 4, top: 0, bottom: 0, justifyContent: 'center' }, arrowStyle]}
      >
        <Ionicons name="arrow-undo" size={20} color={theme.colors.primary} />
      </Animated.View>

      <Animated.View
        style={[{ alignItems: mine ? 'flex-end' : 'flex-start' }, slideStyle]}
        {...pan.panHandlers}
      >
        <View>
          {/* Long-press for actions; double-tap to ❤️; swipe right to reply — Phase 18 Slice 2. */}
          <Pressable
            onPress={handlePress}
            onLongPress={onLongPress}
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
            {reply ? <QuoteBox reply={reply} mine={mine} authorLabel={authorLabel} /> : null}
            <Text variant="body" color={mine ? theme.colors.onPrimary : theme.colors.text}>
              {body}
            </Text>
          </Pressable>
          <Animated.View
            pointerEvents="none"
            style={[
              { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
              burstStyle,
            ]}
          >
            <Emoji char="❤️" size={44} />
          </Animated.View>
        </View>
        <ReactionChips reactions={reactions} myId={myId} mine={mine} onToggle={onToggleReaction} />
        <Text variant="caption" muted style={{ fontSize: 10, marginTop: 2, marginHorizontal: 4 }}>
          {time}
          {edited ? ` · ${t('chat.edited')}` : ''}
        </Text>
      </Animated.View>
    </View>
  );
}

function DayDivider({ at }: { at: string }) {
  const { t } = useTranslation();
  const d = new Date(at);
  const today = dayKey(new Date().toISOString());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  let label: string;
  if (dayKey(at) === today) label = t('chat.today');
  else if (dayKey(at) === dayKey(yesterday.toISOString())) label = t('chat.yesterday');
  else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <View style={{ alignItems: 'center', marginVertical: theme.spacing.md }}>
      <View
        style={{
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 4,
          borderRadius: theme.radii.full,
          backgroundColor: theme.colors.glass,
          borderWidth: 1,
          borderColor: theme.colors.glassBorder,
        }}
      >
        <Text variant="caption" muted style={{ fontSize: 11 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export default function ChatThread() {
  const { id: otherId, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuth();
  const myId = session?.user?.id;
  // Measured header height → exact keyboard offset (the hardcoded 90 clipped).
  const headerHeight = useHeaderHeight();

  // Stored newest-first to feed an inverted FlatList (index 0 renders at bottom).
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<ReactionMap>({});
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [banned, setBanned] = useState(false);
  // Phase 18 Slice 3: appeal (when banned) + the per-person disclaimer gate.
  const [hasOpenAppeal, setHasOpenAppeal] = useState(false);
  const [appealSheetOpen, setAppealSheetOpen] = useState(false);
  const [appealing, setAppealing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [acking, setAcking] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actionsFor, setActionsFor] = useState<Message | null>(null);

  // Report flow (Phase 18 Slice 1): which incoming message is being reported.
  const [reportId, setReportId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  // Loaded message ids — lets the reactions realtime handler ignore other threads.
  const loadedIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    loadedIds.current = new Set(messages.map((m) => m.id));
  }, [messages]);

  const canEdit = useCallback(
    (m: Message) => m.sender_id === myId && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS,
    [myId],
  );

  // Initial page + reactions + my ban state.
  useEffect(() => {
    if (!myId || !otherId) return;
    let active = true;
    (async () => {
      try {
        const page = await listConversation(myId, otherId); // oldest-first
        const rx = await listReactions(page.map((m) => m.id));
        if (active) {
          setMessages([...page].reverse()); // → newest-first
          setHasMore(page.length === CONVERSATION_PAGE_SIZE);
          setReactions(rx.reduce((acc, r) => addToMap(acc, r), {} as ReactionMap));
        }
      } catch {
        /* keep empty */
      } finally {
        if (active) setLoading(false);
      }
      try {
        const isBanned = await fetchMyBanState(myId);
        if (active) setBanned(isBanned);
        if (isBanned) {
          const open = await fetchMyOpenAppeal(myId);
          if (active) setHasOpenAppeal(open);
        }
      } catch {
        /* non-fatal: send still fails closed server-side */
      }
      try {
        const acked = await fetchChatAcknowledged(myId, otherId);
        if (active) setAcknowledged(acked);
      } catch {
        /* non-fatal: the gate just shows; accepting is idempotent */
      }
    })();
    return () => {
      active = false;
    };
  }, [myId, otherId]);

  // Realtime: the counterpart's new messages + their edits, and reaction changes.
  useEffect(() => {
    if (!myId || !otherId) return;
    const msgChannel = subscribeToIncoming(
      myId,
      (m) => {
        if (m.sender_id !== otherId) return;
        setMessages((prev) => {
          if (prev.some((x) => x.id === m.id)) return prev;
          // Realtime rows have no embedded quote — resolve it from loaded messages.
          let resolved = m;
          if (m.reply_to_id && !m.reply_to) {
            const parent = prev.find((p) => p.id === m.reply_to_id);
            resolved = {
              ...m,
              reply_to: parent ? { id: parent.id, body: parent.body, sender_id: parent.sender_id } : null,
            };
          }
          return [resolved, ...prev];
        });
      },
      (m) => {
        if (m.sender_id === otherId)
          setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, body: m.body, edited_at: m.edited_at } : x)));
      },
    );
    const rxChannel = subscribeToReactions(myId, ({ type, reaction }) => {
      if (type === 'INSERT') {
        if (loadedIds.current.has(reaction.message_id)) setReactions((prev) => addToMap(prev, reaction));
      } else {
        setReactions((prev) => removeFromMap(prev, reaction));
      }
    });
    const channels: RealtimeChannel[] = [msgChannel, rxChannel];
    return () => {
      channels.forEach((c) => supabase.removeChannel(c));
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
      const rx = await listReactions(page.map((m) => m.id));
      setReactions((prev) => rx.reduce((acc, r) => addToMap(acc, r), { ...prev }));
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }, [myId, otherId, loadingMore, hasMore, messages]);

  async function onSend() {
    const body = input.trim();
    if (!body || !otherId || sending) return;

    // Edit mode: update the existing message instead of sending a new one.
    if (editingId) {
      const id = editingId;
      setSending(true);
      try {
        const updated = await editMessage({ message_id: id, body });
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, body: updated.body, edited_at: updated.edited_at } : m)),
        );
        setEditingId(null);
        setInput('');
      } catch (err) {
        if (errIs(err, 'banned')) setBanned(true);
        else if (errIs(err, 'edit_window')) Alert.alert(t('chat.editWindowTitle'), t('chat.editWindowBody'));
        else Alert.alert(t('common.error'), t('chat.sendFailed'));
      } finally {
        setSending(false);
      }
      return;
    }

    const replyId = replyTo?.id;
    setInput('');
    setReplyTo(null);
    setSending(true);
    try {
      const sent = await sendMessage({ recipient_id: otherId, body, reply_to_id: replyId });
      setMessages((prev) => (prev.some((x) => x.id === sent.id) ? prev : [sent, ...prev]));
    } catch (err) {
      setInput(body); // restore on failure
      if (replyTo) setReplyTo(replyTo);
      if (errIs(err, 'banned')) setBanned(true);
    } finally {
      setSending(false);
    }
  }

  // Reply + edit are mutually exclusive composer modes.
  function startReply(m: Message) {
    setActionsFor(null);
    setEditingId(null);
    setReplyTo(m);
  }

  const myReactionEmojis = useCallback(
    (messageId: string): ReactionEmoji[] =>
      (reactions[messageId] ?? []).filter((r) => r.user_id === myId).map((r) => r.emoji),
    [reactions, myId],
  );

  // Double-tap a bubble → ❤️ it (adds the heart if it isn't already there; the burst
  // animation plays in the bubble regardless). Removal stays on the chip / actions sheet.
  function heartMessage(messageId: string) {
    if (!myId || banned) return;
    if (!myReactionEmojis(messageId).includes('❤️')) toggleReaction(messageId, '❤️');
  }

  async function toggleReaction(messageId: string, emoji: ReactionEmoji) {
    if (!myId || banned) return;
    const mineReacted = myReactionEmojis(messageId).includes(emoji);
    const r: Reaction = { message_id: messageId, user_id: myId, emoji };
    // Optimistic; reconcile on failure.
    setReactions((prev) => (mineReacted ? removeFromMap(prev, r) : addToMap(prev, r)));
    try {
      if (mineReacted) await removeReaction({ message_id: messageId, emoji });
      else await addReaction({ message_id: messageId, emoji });
    } catch (err) {
      setReactions((prev) => (mineReacted ? addToMap(prev, r) : removeFromMap(prev, r))); // revert
      if (errIs(err, 'banned')) setBanned(true);
    }
  }

  function startEdit(m: Message) {
    setActionsFor(null);
    setReplyTo(null);
    setEditingId(m.id);
    setInput(m.body);
  }
  function cancelEdit() {
    setEditingId(null);
    setInput('');
  }

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

  // A banned user appeals; idempotent server-side (one open appeal per user).
  async function submitAppeal(note: string) {
    setAppealing(true);
    try {
      await submitBanAppeal(note);
      setHasOpenAppeal(true);
      setAppealSheetOpen(false);
      Alert.alert(t('appeal.submittedTitle'), t('appeal.submittedBody'));
    } catch {
      Alert.alert(t('appeal.failTitle'), t('appeal.failBody'));
    } finally {
      setAppealing(false);
    }
  }

  // Accept the per-person chat disclaimer; unlocks the composer for this thread.
  async function acceptDisclaimer() {
    if (!otherId) return;
    setAcking(true);
    try {
      await acknowledgeChatTerms(otherId);
      setAcknowledged(true);
    } catch {
      Alert.alert(t('chat.sendFailed'), '');
    } finally {
      setAcking(false);
    }
  }

  const actionTarget = actionsFor;
  // Gate the very first message to a new person behind the disclaimer. Shown only
  // for a brand-new pairing (you haven't sent here yet); existing/legacy threads and
  // banned users are never gated here.
  const needsAck = !banned && !acknowledged && !messages.some((m) => m.sender_id === myId);

  return (
    <>
      <Stack.Screen options={{ title: name ?? t('chat.title') }} />
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
                  <Text variant="title" align="center">
                    {t('chat.emptyTitle')}
                  </Text>
                  <Text variant="body" muted align="center" style={{ marginTop: theme.spacing.xs }}>
                    {t('chat.emptySub')}
                  </Text>
                </View>
              }
              renderItem={({ item, index }) => {
                // Inverted list: the visually-older neighbour is at index+1. Show a day
                // divider above the first (oldest) message of each calendar day.
                const older = messages[index + 1];
                const showDivider = !older || dayKey(older.created_at) !== dayKey(item.created_at);
                return (
                  <View>
                    {showDivider ? <DayDivider at={item.created_at} /> : null}
                    <Bubble
                      mine={item.sender_id === myId}
                      body={item.body}
                      at={item.created_at}
                      edited={item.edited_at != null}
                      reply={item.reply_to}
                      counterpartName={name ?? t('chat.them')}
                      reactions={reactions[item.id] ?? []}
                      myId={myId ?? ''}
                      onLongPress={() => setActionsFor(item)}
                      onToggleReaction={(emoji) => toggleReaction(item.id, emoji)}
                      onDoubleTap={banned ? undefined : () => heartMessage(item.id)}
                      onReply={banned ? undefined : () => startReply(item)}
                    />
                  </View>
                );
              }}
            />
          )}

          {/* Composer — replaced by a blocked notice (banned) or the per-person
              disclaimer gate (first contact). */}
          {banned ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: theme.spacing.md,
                padding: theme.spacing.lg,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Ionicons name="ban-outline" size={22} color={theme.colors.danger} />
              <View style={{ flex: 1, gap: theme.spacing.sm }}>
                <Text variant="bodyStrong" color={theme.colors.danger}>
                  {t('chat.blockedTitle')}
                </Text>
                <Text variant="caption" muted>
                  {t('chat.blockedBody')}
                </Text>
                {hasOpenAppeal ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
                    <Ionicons name="time-outline" size={14} color={theme.colors.textMuted} />
                    <Text variant="caption" muted>
                      {t('chat.appealPending')}
                    </Text>
                  </View>
                ) : (
                  <Button
                    title={t('chat.appealCta')}
                    variant="ghost"
                    onPress={() => setAppealSheetOpen(true)}
                    style={{ alignSelf: 'flex-start' }}
                  />
                )}
              </View>
            </View>
          ) : needsAck ? (
            <View
              style={{
                gap: theme.spacing.md,
                padding: theme.spacing.lg,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
                <Ionicons name="shield-outline" size={22} color={theme.colors.primary} />
                <View style={{ flex: 1, gap: theme.spacing.xs }}>
                  <Text variant="bodyStrong">{t('chat.disclaimerTitle')}</Text>
                  <Text variant="caption" muted>
                    {t('chat.disclaimerBody')}
                  </Text>
                  <Pressable onPress={() => router.push('/community-guidelines')} hitSlop={8}>
                    <Text variant="caption" color={theme.colors.primary}>
                      {t('chat.readGuidelines')}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <Button title={t('chat.disclaimerAgree')} onPress={acceptDisclaimer} loading={acking} />
            </View>
          ) : (
            <View>
              {editingId ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.lg,
                    paddingTop: theme.spacing.sm,
                  }}
                >
                  <Ionicons name="create-outline" size={14} color={theme.colors.primary} />
                  <Text variant="caption" color={theme.colors.primary} style={{ flex: 1 }}>
                    {t('chat.editingBanner')}
                  </Text>
                  <Pressable onPress={cancelEdit} hitSlop={8}>
                    <Text variant="caption" muted>
                      {t('common.cancel')}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {replyTo && !editingId ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.lg,
                    paddingTop: theme.spacing.sm,
                  }}
                >
                  <Ionicons name="arrow-undo-outline" size={16} color={theme.colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" color={theme.colors.primary} style={{ fontSize: 11 }}>
                      {t('chat.replyingTo', {
                        name: replyTo.sender_id === myId ? t('chat.you') : name ?? t('chat.them'),
                      })}
                    </Text>
                    <Text variant="caption" muted numberOfLines={1} style={{ fontSize: 12 }}>
                      {replyTo.body}
                    </Text>
                  </View>
                  <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                    <Ionicons name="close" size={18} color={theme.colors.textMuted} />
                  </Pressable>
                </View>
              ) : null}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  gap: theme.spacing.sm,
                  padding: theme.spacing.md,
                  borderTopWidth: editingId || replyTo ? 0 : 1,
                  borderTopColor: theme.colors.border,
                  backgroundColor: theme.colors.bg,
                }}
              >
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={t('chat.messagePlaceholder')}
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
                    name={editingId ? 'checkmark' : 'send'}
                    size={18}
                    color={input.trim().length === 0 ? theme.colors.textMuted : theme.colors.onPrimary}
                  />
                </Pressable>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>

        <MessageActionsSheet
          visible={actionTarget !== null}
          mine={actionTarget?.sender_id === myId}
          canEdit={actionTarget != null && canEdit(actionTarget) && !banned}
          canReact={!banned}
          canReply={!banned}
          myReactions={actionTarget ? myReactionEmojis(actionTarget.id) : []}
          busy={false}
          onReact={(emoji) => {
            const target = actionTarget;
            setActionsFor(null);
            if (target) toggleReaction(target.id, emoji);
          }}
          onReply={() => actionTarget && startReply(actionTarget)}
          onEdit={() => actionTarget && startEdit(actionTarget)}
          onReport={() => {
            const target = actionTarget;
            setActionsFor(null);
            if (target) setReportId(target.id);
          }}
          onClose={() => setActionsFor(null)}
        />

        <ReportMessageSheet
          visible={reportId !== null}
          busy={reporting}
          onPick={submitReport}
          onClose={() => setReportId(null)}
        />

        <BanAppealSheet
          visible={appealSheetOpen}
          busy={appealing}
          onSubmit={submitAppeal}
          onClose={() => setAppealSheetOpen(false)}
        />
      </Screen>
    </>
  );
}

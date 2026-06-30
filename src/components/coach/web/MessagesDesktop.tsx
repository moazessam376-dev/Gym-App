// MessagesDesktop — the TRUE 3-pane coach web Messages view (replaces the old inbox-only
// list). Mounted by app/(tabs)/messages.tsx via `if (wide) return <MessagesDesktop/>`, so it
// renders ONLY on wide web for a coach; the mobile/native chat tree (app/chat/[id].tsx) is
// untouched. Three rounded Card panels fill the shell content area:
//   LEFT   = Inbox (conversation previews + search)
//   MIDDLE = the active conversation (day-grouped bubbles + composer)
//   RIGHT  = a client snapshot (goal · adherence · progress · active plan)
// It reuses the SAME data layer as mobile (useConversationPreviews / listConversation /
// sendMessage / subscribeToIncoming / markConversationRead) + the coach analytics hooks — no
// new query or RPC. Module-scope row/bubble components each get their OWN useTranslation.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import {
  useBodyMetricsBoard,
  useCoachAdherence,
  useConversationPreviews,
  useMyClients,
  usePlansForClient,
  useRefreshOnFocus,
} from '@/lib/queries/home';
import {
  listConversation,
  markConversationRead,
  sendMessage,
  subscribeToIncoming,
  type ConversationPreview,
  type Message,
} from '@/lib/messages';
import { ensureMicPermission, startWebRecording, uploadVoiceNoteBytes, type WebRecorder } from '@/lib/voice';
import { adherenceScore, type AdherenceRow } from '@/lib/analytics';
import type { BoardRow, GoalProgress } from '@/lib/body-metrics';
import { compactTimeParts } from '@/lib/notifications';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { textStart } from '@/lib/rtl';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Badge, Button, Card, EmptyState, Icon, IconButton, Input, Screen, Text, useToast } from '@/components/ui';
import { theme } from '@/theme';

// useBodyMetricsBoard runs `rankBoard` in its `select`, so each row carries `progress`.
type RankedBoardRow = BoardRow & { progress: GoalProgress; rank: number };

/** Adherence-% tint, matching CoachHome / ClientsDesktop thresholds. */
function adherenceColor(pct: number | null): string {
  if (pct == null) return theme.colors.textMuted;
  if (pct >= 70) return theme.colors.success;
  if (pct >= 40) return theme.colors.warning;
  return theme.colors.danger;
}

/** Local HH:MM for a message timestamp (UTC stored, shown device-local). */
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** A device-local day bucket key (so the thread groups by calendar day, no UTC drift). */
function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// A thread is a flat list of day dividers + message bubbles (oldest → newest).
type ThreadItem =
  | { kind: 'divider'; id: string; label: string }
  | { kind: 'msg'; id: string; message: Message };

export function MessagesDesktop() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { peer: peerParam } = useLocalSearchParams<{ peer?: string }>();
  const myUserId = session?.user?.id;

  // ── Shared cached reads (same keys the mobile screens + Home warm) ──
  const previewsQ = useConversationPreviews();
  const adherenceQ = useCoachAdherence();
  const boardQ = useBodyMetricsBoard();
  useRefreshOnFocus(() => previewsQ.refetch());

  const previews = previewsQ.data ?? [];
  const clientsQ = useMyClients();

  // The inbox shows ALL of the coach's clients — those with a thread (real preview, newest
  // first) AND those never messaged yet (synthetic entry → "No messages yet"), so a coach
  // can START a new conversation, not only continue existing ones.
  const inbox = useMemo<ConversationPreview[]>(() => {
    const seen = new Set<string>();
    const merged: ConversationPreview[] = [];
    for (const p of previews) {
      merged.push(p);
      seen.add(p.peer_id);
    }
    for (const c of clientsQ.data ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      merged.push({
        peer_id: c.id,
        full_name: c.full_name ?? c.invited_email ?? null,
        avatar_media_id: null,
        last_body: '',
        last_at: '',
        last_from_me: false,
        is_voice: false,
        is_note: false,
        unread_count: 0,
      });
    }
    return merged;
  }, [previews, clientsQ.data]);

  // ── Selection + local conversation state ──
  const [query, setQuery] = useState('');
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const threadRef = useRef<ScrollView | null>(null);
  const webRecRef = useRef<WebRecorder | null>(null);

  // Responsive 3-pane: collapse the snapshot first, then the inbox, as the window narrows
  // so the CONVERSATION always has room. Width-derived defaults; the header toggles override.
  const { width } = useWindowDimensions();
  const fitsInbox = width >= 900;
  const fitsSnapshot = width >= 1200;
  const [inboxOverride, setInboxOverride] = useState<boolean | null>(null);
  const [snapshotOverride, setSnapshotOverride] = useState<boolean | null>(null);
  const showInbox = !selectedPeer || (inboxOverride ?? fitsInbox);
  const showSnapshot = snapshotOverride ?? fitsSnapshot;

  // Recording timer (mm:ss) so it's obvious a voice note is being captured.
  useEffect(() => {
    if (!recording) {
      setRecordSecs(0);
      return;
    }
    const id = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);
  // Current peer in a ref so the ONE realtime subscription reads it WITHOUT re-subscribing
  // per selection (re-subscribing the same channel throws "cannot add callbacks after subscribe").
  const selectedPeerRef = useRef<string | null>(null);
  selectedPeerRef.current = selectedPeer;

  // Default the selection: a ?peer deep-link (e.g. bounced from /chat/[id] on resize) wins,
  // else the first inbox entry once data loads.
  useEffect(() => {
    if (selectedPeer) return;
    if (peerParam) {
      setSelectedPeer(peerParam);
      return;
    }
    if (inbox.length > 0) setSelectedPeer(inbox[0].peer_id);
  }, [inbox, selectedPeer, peerParam]);

  // Realtime incoming — subscribe ONCE per user. A unique channel name + reading the peer
  // from a ref means we never call .on() on an already-subscribed channel. Cleaned up on unmount.
  useEffect(() => {
    if (!myUserId) return;
    const key = `desktop-${Math.random().toString(36).slice(2)}`;
    const channel = subscribeToIncoming(
      myUserId,
      (m) => {
        queryClient.invalidateQueries({ queryKey: ['conversation-previews'] }); // any sender → refresh inbox
        if (m.sender_id !== selectedPeerRef.current) return; // only the open thread appends
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        markConversationRead(m.sender_id).catch(() => {});
      },
      undefined,
      key,
    );
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myUserId]);

  // Load the selected conversation + clear its unread badge (NO subscription here).
  useEffect(() => {
    if (!myUserId || !selectedPeer) return;
    let active = true;
    setThreadLoading(true);
    listConversation(myUserId, selectedPeer, { limit: 50 })
      .then((msgs) => {
        if (active) setMessages(msgs);
      })
      .catch(() => {
        if (active) setMessages([]);
      })
      .finally(() => {
        if (active) setThreadLoading(false);
      });
    markConversationRead(selectedPeer)
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversation-previews'] }))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [myUserId, selectedPeer]);

  // ── Derived inbox + snapshot lookups ──
  const filteredPreviews = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inbox;
    return inbox.filter((p) => (p.full_name ?? '').toLowerCase().includes(q));
  }, [inbox, query]);

  const newConversations = useMemo(
    () => inbox.filter((p) => (p.unread_count ?? 0) > 0).length,
    [inbox],
  );

  const adherenceByClient = useMemo(
    () => new Map<string, AdherenceRow>((adherenceQ.data ?? []).map((r) => [r.client_id, r])),
    [adherenceQ.data],
  );
  const boardByClient = useMemo(
    () => new Map<string, RankedBoardRow>(((boardQ.data ?? []) as RankedBoardRow[]).map((r) => [r.client_id, r])),
    [boardQ.data],
  );

  const selectedPreview = useMemo(
    () => inbox.find((p) => p.peer_id === selectedPeer) ?? null,
    [inbox, selectedPeer],
  );
  const peerName = selectedPreview?.full_name ?? t('messages.client');

  // The active conversation, grouped into day dividers + bubbles.
  const thread = useMemo<ThreadItem[]>(() => {
    const items: ThreadItem[] = [];
    let lastDay = '';
    const todayKey = dayKeyOf(new Date());
    for (const m of messages) {
      const d = new Date(m.created_at);
      const dk = dayKeyOf(d);
      if (dk !== lastDay) {
        lastDay = dk;
        const label = dk === todayKey ? t('chat.today') : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        items.push({ kind: 'divider', id: `d-${dk}`, label });
      }
      items.push({ kind: 'msg', id: m.id, message: m });
    }
    return items;
  }, [messages, t]);

  // ── Snapshot values (real data only — no fabrication) ──
  const adh = selectedPeer ? adherenceByClient.get(selectedPeer) : undefined;
  const board = selectedPeer ? boardByClient.get(selectedPeer) : undefined;
  const goal = board?.primary_goal ?? adh?.primary_goal ?? null;
  const goalLabel = goal ? t(`goals.${goal}`, { defaultValue: goal }) : null;
  const adherencePct = adh ? adherenceScore(adh).overallPct : null;
  const progress = board?.progress;
  const progressColor = progress?.hasTrend
    ? progress.score >= 0
      ? theme.colors.primary
      : theme.colors.warning
    : theme.colors.textMuted;

  // The selected client's active (published) plan title, if any.
  const plansQ = usePlansForClient(selectedPeer ?? undefined);
  const activePlanTitle = (plansQ.data ?? []).find((p) => p.status === 'published')?.title ?? '—';

  // ── Send (optimistic; revert + toast on failure) ──
  const send = async () => {
    const body = draft.trim();
    if (!body || !selectedPeer || sending) return;
    setSending(true);
    setDraft('');
    try {
      const msg = await sendMessage({ recipient_id: selectedPeer, body });
      setMessages((prev) => [...prev, msg]);
    } catch {
      setDraft(body); // revert so the coach doesn't lose their text
      toast.show(t('chat.sendFailed'), 'error');
    } finally {
      setSending(false);
    }
  };

  // ── Voice note (web MediaRecorder). Empty composer → mic; tap to record, tap again to
  // stop+upload+send. (Alert.alert no-ops on web, so permission errors use a toast.) ──
  const toggleVoice = async () => {
    if (Platform.OS !== 'web' || !selectedPeer || recordBusy) return;
    if (recording) {
      setRecordBusy(true);
      const rec = webRecRef.current;
      webRecRef.current = null;
      setRecording(false);
      try {
        if (!rec) return;
        const { bytes, mimeType } = await rec.stop();
        const mediaId = await uploadVoiceNoteBytes(bytes, mimeType);
        const msg = await sendMessage({ recipient_id: selectedPeer, body: '', media_id: mediaId });
        setMessages((prev) => [...prev, msg]);
        queryClient.invalidateQueries({ queryKey: ['conversation-previews'] });
      } catch {
        toast.show(t('chat.sendFailed'), 'error');
      } finally {
        setRecordBusy(false);
      }
    } else {
      setRecordBusy(true);
      try {
        if (!(await ensureMicPermission())) {
          toast.show(t('chat.micDeniedBody'), 'error');
          return;
        }
        webRecRef.current = await startWebRecording();
        setRecording(true);
      } catch {
        toast.show(t('chat.sendFailed'), 'error');
      } finally {
        setRecordBusy(false);
      }
    }
  };

  // Discard a recording in progress (no send).
  const cancelVoice = () => {
    webRecRef.current?.cancel();
    webRecRef.current = null;
    setRecording(false);
  };
  const recMmss = `${Math.floor(recordSecs / 60)}:${String(recordSecs % 60).padStart(2, '0')}`;

  const panelStyle = { backgroundColor: theme.colors.surface, overflow: 'hidden' as const };

  return (
    <Screen gradient contentStyle={{ paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
      <View style={{ flex: 1, flexDirection: 'row', gap: theme.spacing.lg }}>
        {/* ───────────── LEFT: Inbox (foldable) ───────────── */}
        {showInbox ? (
        <Card padded={false} style={{ width: 320, ...panelStyle }}>
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <Text variant="title" style={[textStart, { flex: 1 }]}>
                {t('webportal.messages.inbox')}
              </Text>
              {newConversations > 0 ? (
                <Badge label={t('webportal.messages.newCount', { count: newConversations })} tone="primary" solid />
              ) : null}
            </View>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder={t('chat.searchPlaceholder')}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {filteredPreviews.length === 0 ? (
              <View style={{ paddingTop: theme.spacing.xxl }}>
                <EmptyState
                  icon={query ? 'search' : 'chatbubbles-outline'}
                  title={query ? t('chat.noResults') : t('webportal.messages.noConversations')}
                  subtitle={query ? undefined : t('webportal.messages.noConversationsSub')}
                />
              </View>
            ) : (
              <View style={{ padding: theme.spacing.sm, gap: 2 }}>
                {filteredPreviews.map((p) => (
                  <InboxRow
                    key={p.peer_id}
                    preview={p}
                    selected={p.peer_id === selectedPeer}
                    onPress={() => setSelectedPeer(p.peer_id)}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        </Card>
        ) : null}

        {/* ───────────── MIDDLE: Conversation ───────────── */}
        <Card padded={false} style={{ flex: 1, minWidth: 0, ...panelStyle }}>
          {!selectedPeer ? (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <EmptyState
                icon="message-square"
                title={t('webportal.messages.selectConversation')}
                subtitle={t('webportal.messages.selectConversationSub')}
              />
            </View>
          ) : (
            <>
              {/* Conversation header */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  padding: theme.spacing.lg,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                }}
              >
                {/* Fold/unfold the inbox to give the conversation more room. */}
                <IconButton
                  name="message-square"
                  color={showInbox ? theme.colors.primary : theme.colors.textMuted}
                  onPress={() => setInboxOverride(!showInbox)}
                />
                <ProfileAvatar name={peerName} avatarMediaId={selectedPreview?.avatar_media_id ?? null} size={42} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text variant="title" numberOfLines={1} style={textStart}>
                    {peerName}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 7, height: 7, borderRadius: theme.radii.full, backgroundColor: theme.colors.success }} />
                    <Text variant="caption" muted>
                      {t('webportal.messages.online')}
                    </Text>
                  </View>
                </View>
                <IconButton name="phone" onPress={() => router.push('/coach/calls')} />
                <IconButton name="video" onPress={() => router.push('/coach/calls')} />
                {/* Fold/unfold the client snapshot. */}
                <IconButton
                  name="user"
                  color={showSnapshot ? theme.colors.primary : theme.colors.textMuted}
                  onPress={() => setSnapshotOverride(!showSnapshot)}
                />
              </View>

              {/* Thread */}
              <ScrollView
                ref={threadRef}
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() => threadRef.current?.scrollToEnd({ animated: false })}
              >
                {threadLoading && messages.length === 0 ? null : thread.length === 0 ? (
                  <View style={{ paddingTop: theme.spacing.xxxl }}>
                    <EmptyState icon="chatbubbles-outline" title={t('chat.emptyTitle')} subtitle={t('chat.emptySub')} />
                  </View>
                ) : (
                  thread.map((item) =>
                    item.kind === 'divider' ? (
                      <View key={item.id} style={{ alignItems: 'center', paddingVertical: theme.spacing.sm }}>
                        <Text variant="mono" muted style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
                          {item.label}
                        </Text>
                      </View>
                    ) : (
                      <MessageBubble key={item.id} message={item.message} isMe={item.message.sender_id === myUserId} />
                    ),
                  )
                )}
              </ScrollView>

              {/* Composer — recording bar while capturing a voice note, else the text row. */}
              {recording ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    padding: theme.spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border,
                  }}
                >
                  {/* Cancel (discard) */}
                  <Pressable
                    onPress={cancelVoice}
                    disabled={recordBusy}
                    accessibilityRole="button"
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: theme.radii.full,
                      backgroundColor: theme.colors.surfaceElevated,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="x" size={20} color={theme.colors.textMuted} />
                  </Pressable>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <View style={{ width: 9, height: 9, borderRadius: theme.radii.full, backgroundColor: theme.colors.danger }} />
                    <Text variant="mono" style={{ fontSize: 15 }}>
                      {recMmss}
                    </Text>
                    <Text variant="caption" muted>
                      {t('webportal.messages.recording')}
                    </Text>
                  </View>
                  {/* Stop + send */}
                  <Pressable
                    onPress={toggleVoice}
                    disabled={recordBusy}
                    accessibilityRole="button"
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: theme.radii.full,
                      backgroundColor: theme.colors.primary,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: recordBusy ? 0.6 : 1,
                    }}
                  >
                    <Icon name="send" size={20} color={theme.colors.onPrimary} />
                  </Pressable>
                </View>
              ) : (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    padding: theme.spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border,
                  }}
                >
                  <Input
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={send}
                    placeholder={t('webportal.messages.composer', { name: peerName })}
                    returnKeyType="send"
                    containerStyle={{ flex: 1 }}
                  />
                  {draft.trim() ? (
                    <Pressable
                      onPress={send}
                      disabled={sending}
                      accessibilityRole="button"
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: theme.radii.full,
                        backgroundColor: theme.colors.primary,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: sending ? 0.5 : 1,
                      }}
                    >
                      <Icon name="send" size={20} color={theme.colors.onPrimary} />
                    </Pressable>
                  ) : (
                    // Empty composer → mic (web records a voice note).
                    <Pressable
                      onPress={toggleVoice}
                      disabled={recordBusy || Platform.OS !== 'web'}
                      accessibilityRole="button"
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: theme.radii.full,
                        backgroundColor: theme.colors.surfaceElevated,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: recordBusy || Platform.OS !== 'web' ? 0.5 : 1,
                      }}
                    >
                      <Icon name="mic" size={20} color={theme.colors.primary} />
                    </Pressable>
                  )}
                </View>
              )}
            </>
          )}
        </Card>

        {/* ───────────── RIGHT: Client snapshot (foldable) ───────────── */}
        {showSnapshot ? (
        <Card padded={false} style={{ width: 300, ...panelStyle }}>
          {!selectedPeer ? (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <EmptyState icon="user" title={t('webportal.messages.selectConversation')} />
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }} showsVerticalScrollIndicator={false}>
              {/* Identity */}
              <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                <ProfileAvatar name={peerName} avatarMediaId={selectedPreview?.avatar_media_id ?? null} size={84} />
                <Text variant="h2" align="center" numberOfLines={1}>
                  {peerName}
                </Text>
                {goalLabel ? <Badge label={goalLabel} tone="secondary" /> : null}
              </View>

              <View style={{ height: 1, backgroundColor: theme.colors.border }} />

              {/* Snapshot rows */}
              <View style={{ gap: theme.spacing.md }}>
                <Text variant="label" muted style={textStart}>
                  {t('webportal.messages.snapshot')}
                </Text>
                <SnapStat
                  label={t('webportal.clients.statAdherence')}
                  value={adherencePct != null ? `${adherencePct}%` : '—'}
                  color={adherenceColor(adherencePct)}
                  mono
                />
                <SnapStat
                  label={t('webportal.clients.statProgress')}
                  value={progress?.hasTrend ? progress.headline : '—'}
                  color={progress?.hasTrend ? progressColor : theme.colors.textMuted}
                />
                <SnapStat
                  label={t('webportal.messages.statPlan')}
                  value={activePlanTitle}
                  color={activePlanTitle === '—' ? theme.colors.textMuted : theme.colors.text}
                />
              </View>

              <Button
                title={t('webportal.messages.openProfile')}
                variant="secondary"
                onPress={() => router.push({ pathname: '/coach/client/[id]', params: { id: selectedPeer, name: peerName } })}
              />
            </ScrollView>
          )}
        </Card>
        ) : null}
      </View>
    </Screen>
  );
}

// A single snapshot row: label on the start side, value on the end side. Pure (label/value
// passed in already translated), so no useTranslation needed.
function SnapStat({ label, value, color, mono = false }: { label: string; value: string; color: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm }}>
      <Text variant="caption" muted style={[textStart, { flexShrink: 0 }]}>
        {label}
      </Text>
      <Text
        color={color}
        numberOfLines={1}
        style={[
          { flexShrink: 1, textAlign: 'right' },
          mono ? { fontFamily: theme.fontFamily.monoBold, fontSize: 15 } : theme.textVariants.bodyStrong,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// One inbox row: avatar · name + time · last-message preview · unread badge. Selected → a
// subtle elevated highlight. Module-scope → it gets its OWN useTranslation.
function InboxRow({ preview, selected, onPress }: { preview: ConversationPreview; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const unread = preview.unread_count ?? 0;
  const hasThread = !!preview.last_at;
  const tparts = hasThread ? compactTimeParts(preview.last_at) : null;
  const name = preview.full_name ?? t('messages.client');

  const previewText = (): string => {
    if (!hasThread && !preview.last_body) return t('messages.noMessagesYet');
    const me = preview.last_from_me ? `${t('chat.you')}: ` : '';
    if (preview.is_voice) return `${me}${t('chat.voiceMessage')}`;
    if (preview.is_note) return `${me}${t('chat.noteMessage')}`;
    return `${me}${preview.last_body}`;
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        padding: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: selected ? theme.colors.surfaceElevated : pressed ? theme.colors.surfaceElevated : 'transparent',
      })}
    >
      <ProfileAvatar name={name} avatarMediaId={preview.avatar_media_id} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Text variant="bodyStrong" numberOfLines={1} style={[textStart, { flex: 1 }]}>
            {name}
          </Text>
          {tparts ? (
            <Text variant="caption" muted>
              {t(tparts.key, { count: tparts.count })}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {preview.is_voice ? <Icon name="mic" size={13} color={theme.colors.primary} /> : null}
          <Text
            variant="caption"
            muted
            numberOfLines={1}
            style={[textStart, { flex: 1, fontWeight: unread > 0 ? '600' : '400' }]}
          >
            {previewText()}
          </Text>
          {unread > 0 ? <Badge label={unread > 9 ? '9+' : String(unread)} tone="primary" solid /> : null}
        </View>
      </View>
    </Pressable>
  );
}

// One chat bubble (them = left/elevated, me = right/cyan), with a workout-note card and a
// voice-note chip variant. Time (mono) renders under the bubble. Module-scope → OWN
// useTranslation. Playback/recording is intentionally NOT implemented here (desktop layout
// only) — media renders as a labeled chip.
function MessageBubble({ message, isMe }: { message: Message; isMe: boolean }) {
  const { t } = useTranslation();
  const isNote = !!message.workout_note_id;
  const isVoice = !isNote && !!message.media_id;
  const exercise = message.workout_note?.exercise_name ?? message.workout_note_exercise;

  const bubbleBase = {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.lg,
    maxWidth: '100%' as const,
  };

  let bubble: ReactNode;
  if (isNote) {
    // Workout-note card — bordered, always neutral so it reads as a logged note, not a chat line.
    bubble = (
      <View
        style={{
          ...bubbleBase,
          backgroundColor: theme.colors.surfaceElevated,
          borderWidth: 1,
          borderColor: theme.colors.border,
          gap: 4,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="file-text" size={13} color={theme.colors.primary} />
          <Text variant="label" color="primary">
            {t('chat.note')}
          </Text>
        </View>
        {exercise ? (
          <Text variant="caption" muted style={textStart}>
            {exercise}
          </Text>
        ) : null}
        {message.body ? (
          <Text variant="body" style={textStart}>
            {message.body}
          </Text>
        ) : null}
      </View>
    );
  } else if (isVoice) {
    bubble = (
      <View
        style={{
          ...bubbleBase,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          backgroundColor: isMe ? theme.colors.primary : theme.colors.surfaceElevated,
          borderBottomRightRadius: isMe ? theme.radii.sm : theme.radii.lg,
          borderBottomLeftRadius: isMe ? theme.radii.lg : theme.radii.sm,
        }}
      >
        <Icon name="mic" size={16} color={isMe ? theme.colors.onPrimary : theme.colors.primary} />
        <Text variant="body" color={isMe ? theme.colors.onPrimary : theme.colors.text}>
          {t('chat.voiceMessage')}
        </Text>
      </View>
    );
  } else {
    bubble = (
      <View
        style={{
          ...bubbleBase,
          backgroundColor: isMe ? theme.colors.primary : theme.colors.surfaceElevated,
          borderBottomRightRadius: isMe ? theme.radii.sm : theme.radii.lg,
          borderBottomLeftRadius: isMe ? theme.radii.lg : theme.radii.sm,
        }}
      >
        <Text variant="body" color={isMe ? theme.colors.onPrimary : theme.colors.text} style={textStart}>
          {message.body}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '75%', gap: 2 }}>
      {bubble}
      <Text
        variant="mono"
        muted
        style={{ fontSize: 9, lineHeight: 12, textAlign: isMe ? 'right' : 'left' }}
      >
        {clockTime(message.created_at)}
        {message.edited_at ? ` · ${t('chat.edited')}` : ''}
      </Text>
    </View>
  );
}

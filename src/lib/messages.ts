// Data layer for coach ⇄ client messaging (CLAUDE.md §8). Reads/writes go through
// RLS: you only see messages you sent or received, and may only send to your
// pairing (coach↔client). The sender is set server-side by a trigger, so we never
// send sender_id. Inserts are Zod-validated; the server re-validates via RLS.
//
// Phase 18 Slice 2 adds soft edit (edited_at) and emoji reactions — both server-
// guarded (a trigger owns edit bookkeeping + the reactor id; RLS limits reactions to
// the two parties of the message). See 0036_chat_engagement.sql.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import {
  editMessageSchema,
  reactToMessageSchema,
  sendMessageSchema,
  type EditMessage,
  type ReactionEmoji,
  type ReactToMessage,
  type SendMessage,
} from '../schemas/message';

/** A lightweight quote of the message being replied to (same thread). */
export type ReplyPreview = { id: string; body: string; sender_id: string };

/** The workout note a note-card message mirrors (embedded on read; 0051). */
export type WorkoutNoteRef = {
  id: string;
  category: 'challenge' | 'compliment';
  exercise_name: string | null;
  body: string;
};

export type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  /** null = never edited; set by the server on a soft edit (Phase 18 Slice 2). */
  edited_at: string | null;
  /** The quoted message id, or null (Phase 18 Slice 2 replies). */
  reply_to_id: string | null;
  /** Resolved quote of the replied-to message (embedded on read; may be null). */
  reply_to: ReplyPreview | null;
  /** A voice-note `media` id (kind 'audio'), or null (Phase 18 voice notes). */
  media_id: string | null;
  /** A mirrored workout note's id, or null — renders as a note card not a bubble (0051). */
  workout_note_id: string | null;
  /** Resolved note (category/exercise/body); null on realtime rows until refetch (0051). */
  workout_note: WorkoutNoteRef | null;
  /** Denormalized note context (E6/0080) — present on realtime rows too (no embed needed). */
  workout_note_exercise: string | null;
  workout_note_day: string | null;
  workout_note_date: string | null;
};

export type Reaction = {
  message_id: string;
  user_id: string;
  emoji: ReactionEmoji;
};

// Embeds the quoted message via the self FK so a reply renders its quote in one read.
// PostgREST resolves a SELF-referential embed by the FK COLUMN name (`reply_to_id`),
// NOT the constraint name — the constraint-name hint (messages_reply_to_id_fkey)
// returns PGRST200 "Could not find a relationship between 'messages' and 'messages'".
const MSG_COLS =
  'id, sender_id, recipient_id, body, created_at, edited_at, reply_to_id, media_id, workout_note_id, ' +
  'workout_note_exercise, workout_note_day, workout_note_date, ' +
  'reply_to:messages!reply_to_id(id, body, sender_id), ' +
  'workout_note:workout_notes!workout_note_id(id, category, exercise_name, body)';

// PostgREST types a to-one embed as either an object or a single-element array; this
// normalizes the row into our flat Message shape.
function mapRow(row: unknown): Message {
  const r = row as Omit<Message, 'reply_to' | 'workout_note'> & {
    reply_to: ReplyPreview | ReplyPreview[] | null;
    workout_note: WorkoutNoteRef | WorkoutNoteRef[] | null;
  };
  const reply = Array.isArray(r.reply_to) ? (r.reply_to[0] ?? null) : r.reply_to ?? null;
  const note = Array.isArray(r.workout_note) ? (r.workout_note[0] ?? null) : r.workout_note ?? null;
  return { ...r, reply_to: reply, workout_note: note };
}

/** Default conversation page size (newest N, then page backwards by `before`). */
export const CONVERSATION_PAGE_SIZE = 30;

/**
 * Send a message to a counterpart. sender_id is omitted — the DB trigger sets it
 * to auth.uid(); RLS enforces the coach↔client pairing + the rate limit.
 */
export async function sendMessage(input: SendMessage): Promise<Message> {
  const v = sendMessageSchema.parse(input);
  const { data, error } = await supabase
    .from('messages')
    .insert({
      recipient_id: v.recipient_id,
      body: v.body,
      reply_to_id: v.reply_to_id ?? null,
      media_id: v.media_id ?? null,
    })
    .select(MSG_COLS)
    .single();
  if (error) throw error;
  return mapRow(data);
}

/**
 * Edit (correct) one of your OWN recent messages. The server owns edited_at and the
 * history-preserving original_body, and enforces the sender-only / within-window /
 * not-banned rules (trigger in 0036). Only the body is sent.
 */
export async function editMessage(input: EditMessage): Promise<Message> {
  const v = editMessageSchema.parse(input);
  const { data, error } = await supabase
    .from('messages')
    .update({ body: v.body })
    .eq('id', v.message_id)
    .select(MSG_COLS)
    .single();
  if (error) throw error;
  return mapRow(data);
}

/**
 * One page of the conversation between the signed-in user and one other person,
 * returned oldest-first for rendering. RLS already restricts visibility to the
 * caller's own messages; the OR filter narrows to this pair in both directions.
 *
 * Cursor-based (not offset) so it stays cheap as a thread grows — the DB walks the
 * `(…, created_at)` indexes backwards from the cursor. To load older messages, pass
 * `before = oldestLoadedMessage.created_at` (the first element of the previous
 * page). A short page (< `limit`) means there's no more history.
 */
export async function listConversation(
  myUserId: string,
  otherUserId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<Message[]> {
  const limit = opts.limit ?? CONVERSATION_PAGE_SIZE;
  let query = supabase
    .from('messages')
    .select(MSG_COLS)
    .or(
      `and(sender_id.eq.${myUserId},recipient_id.eq.${otherUserId}),` +
        `and(sender_id.eq.${otherUserId},recipient_id.eq.${myUserId})`,
    )
    // Newest-first + limit fetches the most recent page (and the tail of older
    // pages when `before` is set); we reverse to oldest-first before returning.
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.before) query = query.lt('created_at', opts.before);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapRow).reverse();
}

/** One row of the chat list: the latest message per counterpart + unread state (0058). */
export type ConversationPreview = {
  peer_id: string;
  full_name: string | null;
  avatar_media_id: string | null;
  last_body: string;
  last_at: string;
  last_from_me: boolean;
  is_voice: boolean;
  is_note: boolean;
  unread_count: number;
};

/**
 * The signed-in user's conversations, newest-first, each with its last message +
 * unread count (0058 SECURITY DEFINER RPC, fenced to the caller's own threads). One
 * round-trip — never N calls to listConversation. Powers the Chat tab.
 */
export async function listConversationPreviews(): Promise<ConversationPreview[]> {
  const { data, error } = await supabase.rpc('list_conversation_previews');
  if (error) throw error;
  return (data ?? []).map((r: ConversationPreview) => ({
    ...r,
    unread_count: Number(r.unread_count) || 0,
  }));
}

/** Mark a conversation read up to now (clears its unread badge). Called when a thread opens. */
export async function markConversationRead(peerId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read', { p_peer: peerId });
  if (error) throw error;
}

/**
 * Reactions on a set of messages. RLS limits rows to messages the caller is a party
 * to, so this only returns reactions on the caller's own threads. Empty in → empty out.
 */
export async function listReactions(messageIds: string[]): Promise<Reaction[]> {
  if (messageIds.length === 0) return [];
  const { data, error } = await supabase
    .from('message_reactions')
    .select('message_id, user_id, emoji')
    .in('message_id', messageIds);
  if (error) throw error;
  return (data ?? []) as Reaction[];
}

/** Add one of my reactions to a message in my thread (user_id is server-set). */
export async function addReaction(input: ReactToMessage): Promise<void> {
  const v = reactToMessageSchema.parse(input);
  const { error } = await supabase
    .from('message_reactions')
    .insert({ message_id: v.message_id, emoji: v.emoji });
  if (error) throw error;
}

/** Remove my reaction (RLS limits the delete to my own rows). */
export async function removeReaction(input: ReactToMessage): Promise<void> {
  const v = reactToMessageSchema.parse(input);
  const { error } = await supabase
    .from('message_reactions')
    .delete()
    .eq('message_id', v.message_id)
    .eq('emoji', v.emoji);
  if (error) throw error;
}

/**
 * Subscribe to messages newly addressed TO me (live) and to edits of those messages.
 * Realtime respects RLS, so only rows where I'm the recipient arrive. Returns the
 * channel; call `supabase.removeChannel(channel)` to unsubscribe. (Own sent/edited
 * messages are reflected optimistically by the caller, so we only listen for the
 * counterpart's inserts + edits.)
 *
 * `channelKey` makes the channel TOPIC unique per subscriber. Two subscriptions must
 * never share a topic: Supabase returns the existing channel for a duplicate topic, and
 * adding `.on('postgres_changes', …)` to an already-`subscribe()`d channel throws
 * ("cannot add postgres_changes callbacks after subscribe()"). The app-root chat-list
 * listener and the open chat thread both watch my incoming messages, so they pass
 * DISTINCT keys ('previews' vs the default 'to').
 */
export function subscribeToIncoming(
  myUserId: string,
  onInsert: (m: Message) => void,
  onEdit?: (m: Message) => void,
  channelKey = 'to',
): RealtimeChannel {
  // Raw realtime rows have the columns (incl. reply_to_id, workout_note_id) but not the
  // embedded reply_to quote / workout_note — default them to null. A live note-card
  // message still renders (body + note styling); category/exercise fill in on refetch.
  const coerce = (row: unknown): Message => ({
    ...(row as Message),
    reply_to: (row as Message).reply_to ?? null,
    workout_note: (row as Message).workout_note ?? null,
  });
  return supabase
    .channel(`messages:${channelKey}:${myUserId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${myUserId}` },
      (payload) => onInsert(coerce(payload.new)),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `recipient_id=eq.${myUserId}` },
      (payload) => onEdit?.(coerce(payload.new)),
    )
    .subscribe();
}

/**
 * Subscribe to reaction changes on my threads (live). RLS scopes delivery to messages
 * I'm a party to; DELETE payloads carry the full row (replica identity full in 0036),
 * so the caller can remove the exact reaction. The caller filters to loaded messages.
 */
export function subscribeToReactions(
  myUserId: string,
  onChange: (event: { type: 'INSERT' | 'DELETE'; reaction: Reaction }) => void,
): RealtimeChannel {
  return supabase
    .channel(`reactions:${myUserId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'message_reactions' },
      (payload) => onChange({ type: 'INSERT', reaction: payload.new as Reaction }),
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'message_reactions' },
      (payload) => onChange({ type: 'DELETE', reaction: payload.old as Reaction }),
    )
    .subscribe();
}

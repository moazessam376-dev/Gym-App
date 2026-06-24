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
};

export type Reaction = {
  message_id: string;
  user_id: string;
  emoji: ReactionEmoji;
};

// Embeds the quoted message via the self FK so a reply renders its quote in one read.
const MSG_COLS =
  'id, sender_id, recipient_id, body, created_at, edited_at, reply_to_id, ' +
  'reply_to:messages!messages_reply_to_id_fkey(id, body, sender_id)';

// PostgREST types a to-one embed as either an object or a single-element array; this
// normalizes the row into our flat Message shape.
function mapRow(row: unknown): Message {
  const r = row as Omit<Message, 'reply_to'> & { reply_to: ReplyPreview | ReplyPreview[] | null };
  const reply = Array.isArray(r.reply_to) ? (r.reply_to[0] ?? null) : r.reply_to ?? null;
  return { ...r, reply_to: reply };
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
    .insert({ recipient_id: v.recipient_id, body: v.body, reply_to_id: v.reply_to_id ?? null })
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
 */
export function subscribeToIncoming(
  myUserId: string,
  onInsert: (m: Message) => void,
  onEdit?: (m: Message) => void,
): RealtimeChannel {
  // Raw realtime rows have the columns (incl. reply_to_id) but not the embedded
  // reply_to quote — default it to null; the caller resolves the quote from state.
  const coerce = (row: unknown): Message => ({ ...(row as Message), reply_to: (row as Message).reply_to ?? null });
  return supabase
    .channel(`messages:to:${myUserId}`)
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

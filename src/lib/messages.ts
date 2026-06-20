// Data layer for coach ⇄ client messaging (CLAUDE.md §8). Reads/writes go through
// RLS: you only see messages you sent or received, and may only send to your
// pairing (coach↔client). The sender is set server-side by a trigger, so we never
// send sender_id. Inserts are Zod-validated; the server re-validates via RLS.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { sendMessageSchema, type SendMessage } from '../schemas/message';

export type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
};

const MSG_COLS = 'id, sender_id, recipient_id, body, created_at';

/**
 * Send a message to a counterpart. sender_id is omitted — the DB trigger sets it
 * to auth.uid(); RLS enforces the coach↔client pairing + the rate limit.
 */
export async function sendMessage(input: SendMessage): Promise<Message> {
  const v = sendMessageSchema.parse(input);
  const { data, error } = await supabase
    .from('messages')
    .insert({ recipient_id: v.recipient_id, body: v.body })
    .select(MSG_COLS)
    .single();
  if (error) throw error;
  return data as Message;
}

/**
 * The conversation between the signed-in user and one other person, oldest-first.
 * RLS already restricts visibility to the caller's own messages; the OR filter
 * narrows to this pair in both directions.
 */
export async function listConversation(myUserId: string, otherUserId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(MSG_COLS)
    .or(
      `and(sender_id.eq.${myUserId},recipient_id.eq.${otherUserId}),` +
        `and(sender_id.eq.${otherUserId},recipient_id.eq.${myUserId})`,
    )
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Message[];
}

/**
 * Subscribe to messages newly addressed TO me (live). Realtime respects RLS, so
 * only rows where I'm the recipient arrive. Returns the channel; call
 * `supabase.removeChannel(channel)` to unsubscribe. (Own sent messages are added
 * optimistically by the caller, so we only listen for incoming.)
 */
export function subscribeToIncoming(
  myUserId: string,
  onMessage: (m: Message) => void,
): RealtimeChannel {
  return supabase
    .channel(`messages:to:${myUserId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `recipient_id=eq.${myUserId}`,
      },
      (payload) => onMessage(payload.new as Message),
    )
    .subscribe();
}

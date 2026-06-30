// CallProvider adapter — resolves a call's JOIN TARGET on demand at tap time (mirrors the
// VisionProvider / PaymentProvider adapter pattern). The provider is swappable without
// touching call sites or the schema:
//
//   • Phase A — Jitsi: pure client. The room URL is DERIVED from the call id
//     (meet.jit.si/raptor-<id>), so nothing is minted/stored server-side and there is no
//     room-mint timing window. Jitsi rooms aren't password-protected; the unguessable
//     raptor-<UUID> name + RLS (only the two parties ever see the call id) is the pilot gate.
//   • Phase B — LiveKit: getJoin() will call the `call-token` Edge Function for a fresh,
//     short-lived PER-USER token + room URL, and joinCall() will open the in-app call screen
//     instead of the browser. The `provider` column already allows 'livekit'.
import { Linking } from 'react-native';

const JITSI_BASE = 'https://meet.jit.si';

/** The deterministic Jitsi room name for a call (also its room URL slug). */
export function jitsiRoomName(callId: string): string {
  return `raptor-${callId}`;
}

export function jitsiRoomUrl(callId: string): string {
  return `${JITSI_BASE}/${jitsiRoomName(callId)}`;
}

export type JoinTarget =
  | { kind: 'url'; url: string }
  | { kind: 'token'; url: string; token: string; roomName: string };

/** Resolve the join target for a call. Phase A = a Jitsi URL derived from the id. */
export async function getJoin(call: { id: string; provider?: string }): Promise<JoinTarget> {
  // Phase B:
  //   if (call.provider === 'livekit') {
  //     const { data } = await supabase.functions.invoke('call-token', { body: { call_id: call.id } });
  //     return { kind: 'token', url: data.url, token: data.token, roomName: jitsiRoomName(call.id) };
  //   }
  return { kind: 'url', url: jitsiRoomUrl(call.id) };
}

/** Join a call: Phase A opens the Jitsi room in the browser / Jitsi app. */
export async function joinCall(call: { id: string; provider?: string }): Promise<void> {
  const target = await getJoin(call);
  if (target.kind === 'url') {
    await Linking.openURL(target.url);
  }
  // Phase B: target.kind === 'token' → router.push(`/call/${call.id}`) with the in-app screen.
}

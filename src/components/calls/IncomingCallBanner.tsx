// IncomingCallBanner — a global, client-only listener for coach ad-hoc "Call now" rings.
// Subscribes ONCE to the caller's call rows (web.md: unique channel, cleanup on unmount) and
// shows a modal when a coach_adhoc call goes 'ringing'. Join opens the room (Phase A: Jitsi
// via the adapter); Dismiss marks it missed. The authoritative incoming signal is THIS
// realtime banner (push is best-effort; Phase B adds the native ring). Mounted at the root.
import { useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../lib/auth-context';
import { supabase } from '../../lib/supabase';
import { textStart } from '../../lib/rtl';
import { joinCall } from '../../lib/callProvider';
import { subscribeToCalls, transitionCall, type Call } from '../../lib/calls';
import { Avatar, Button, Text } from '../ui';
import { theme } from '../../theme';

export function IncomingCallBanner() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const userId = session?.user?.id;
  const [call, setCall] = useState<Call | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId || role !== 'client') return;
    const channel = subscribeToCalls(
      userId,
      (c) => {
        if (
          c.client_id === userId &&
          c.origin === 'coach_adhoc' &&
          c.status === 'ringing' &&
          !seenRef.current.has(c.id)
        ) {
          seenRef.current.add(c.id);
          setCall(c);
        } else if (c.status !== 'ringing') {
          // The ring ended elsewhere (answered on another device / missed) — dismiss.
          setCall((cur) => (cur && cur.id === c.id ? null : cur));
        }
      },
      'incoming-banner',
    );
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, role]);

  if (!call) return null;

  const join = () => {
    joinCall(call).catch(() => {});
    setCall(null);
  };
  const dismiss = () => {
    transitionCall(call.id, 'miss').catch(() => {});
    setCall(null);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing.lg, backgroundColor: 'rgba(5,6,9,0.8)' }}>
        <View
          style={{
            width: '100%',
            maxWidth: 360,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.xl,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
            padding: theme.spacing.xl,
            gap: theme.spacing.lg,
            alignItems: 'center',
          }}
        >
          <Avatar name={undefined} size={64} />
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text variant="title" style={textStart}>{t('calls.incoming.title')}</Text>
            <Text variant="caption" muted>{t('calls.incoming.fromCoach')}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md, width: '100%' }}>
            <View style={{ flex: 1 }}>
              <Button title={t('calls.incoming.dismiss')} variant="ghost" onPress={dismiss} fullWidth />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('calls.incoming.join')} onPress={join} fullWidth />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

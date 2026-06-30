// CallCard — a single call row (info + a status badge + an actions slot the screen fills).
// Shared by the client calls list and the coach hub. Module-scope, so its OWN useTranslation.
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, GlassCard, Text, type BadgeTone } from '../ui';
import { theme } from '../../theme';
import { textStart } from '../../lib/rtl';
import type { Call, CallStatus } from '../../lib/calls';

export function statusTone(status: CallStatus): BadgeTone {
  switch (status) {
    case 'accepted':
    case 'in_progress':
      return 'success';
    case 'pending':
    case 'ringing':
      return 'warning';
    case 'completed':
      return 'primary';
    default:
      return 'neutral'; // declined / cancelled / expired / missed
  }
}

export function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function CallCard({
  call,
  counterpartName,
  actions,
}: {
  call: Call;
  counterpartName?: string | null;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <GlassCard style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Avatar name={counterpartName ?? undefined} size={42} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {counterpartName ? (
            <Text variant="bodyStrong" style={textStart} numberOfLines={1}>{counterpartName}</Text>
          ) : null}
          <Text variant="caption" muted style={textStart} numberOfLines={1}>
            {fmtWhen(call.scheduled_at)}
            {call.purpose ? ` · ${t(`calls.purpose.${call.purpose}`)}` : ''}
          </Text>
        </View>
        <Badge label={t(`calls.status.${call.status}`)} tone={statusTone(call.status)} />
      </View>
      {actions ? <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>{actions}</View> : null}
    </GlassCard>
  );
}

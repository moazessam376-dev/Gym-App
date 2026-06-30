// Device-calendar integration (expo-calendar). Adds a confirmed call to the user's native
// calendar (iOS/macOS/Android) with a 15-min alarm, so the OS handles the pre-call reminder
// natively. Native only — web has no device calendar (the button is hidden there). Every call
// is best-effort and never throws; returns true only on a confirmed insert.
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { jitsiRoomUrl } from './callProvider';
import type { Call } from './calls';

async function writableCalendarId(): Promise<string | null> {
  if (Platform.OS === 'ios') {
    const def = await Calendar.getDefaultCalendarAsync().catch(() => null);
    if (def?.id) return def.id;
  }
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = cals.find((c) => c.allowsModifications) ?? cals[0];
  return writable?.id ?? null;
}

/** Add a confirmed call to the device calendar with a 15-min reminder. Returns true on success. */
export async function addCallToDeviceCalendar(call: Call, title: string): Promise<boolean> {
  if (Platform.OS === 'web' || !call.scheduled_at) return false;
  try {
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (perm.status !== 'granted') return false;
    const calId = await writableCalendarId();
    if (!calId) return false;
    const start = new Date(call.scheduled_at);
    const end = new Date(start.getTime() + (call.duration_minutes ?? 30) * 60_000);
    await Calendar.createEventAsync(calId, {
      title,
      startDate: start,
      endDate: end,
      notes: 'Raptor call',
      url: jitsiRoomUrl(call.id),
      alarms: [{ relativeOffset: -15 }],
    });
    return true;
  } catch {
    return false;
  }
}

// Daily "check your calendar" reminder for coaches — a repeating LOCAL notification
// (expo-notifications, no push backend needed; works in Expo Go for local scheduling).
// Idempotent: schedules once and skips if already present. Native only; best-effort.
// Pre-call reminders are handled by the device-calendar alarm (deviceCalendar.ts) instead.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const DAILY_ID = 'raptor-coach-calendar-daily';

/** Ensure a daily 9am local reminder is scheduled for the coach. Safe to call on every
 *  calls-hub mount — it no-ops if already scheduled, on web, or without permission. */
export async function ensureDailyCoachReminder(title: string, body: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    let granted = perm.granted;
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return;

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    if (scheduled.some((s) => s.identifier === DAILY_ID)) return;

    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_ID,
      content: { title, body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 9, minute: 0 },
    });
  } catch {
    // Local scheduling can be unavailable on some runtimes — never block the UI.
  }
}

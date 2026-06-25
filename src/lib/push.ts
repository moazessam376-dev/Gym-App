// Native push: device-token registration + tap routing (Phase 17, Slice 2).
//
// Registers this device's Expo push token into device_tokens via the
// register_device_token RPC — which server-forces user_id = auth.uid() (0040), so a
// client never asserts ownership. A tap on a delivered push routes to the same screen
// as the in-app feed row (reuses notificationHref). Native push requires a development
// build: this is a deliberate NO-OP in Expo Go, on web, and on simulators, so the hook
// is safe to mount unconditionally — it just does nothing until there's a real build.
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import i18n from '../i18n';
import { supabase } from './supabase';
import { notificationHref, type NotificationRow, type NotificationType } from './notifications';

// Show a banner + play a sound even when a push arrives with the app foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** The active UI language, so push-send can render the body server-side (per device). */
function currentLocale(): 'en' | 'ar' {
  return i18n.language?.startsWith('ar') ? 'ar' : 'en';
}

/** The EAS project id, present only in a real build (absent in Expo Go). */
function easProjectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Ask for permission, mint the Expo push token, and persist it. Fails closed and
 * silent: any unavailable piece (web, simulator, Expo Go, denied permission, no EAS
 * project) just returns — push setup must never crash the app.
 */
export async function registerForPushNotifications(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    // Android only shows a backgrounded push as a heads-up banner if it targets a
    // HIGH-importance notification channel. Create the 'default' channel push-send
    // addresses (channel creation needs no permission). Without this, FCM delivers
    // but the system shows nothing in the tray.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return; // declined — nothing to register

    const projectId = easProjectId();
    if (!projectId) return; // not an EAS build (e.g. Expo Go) — remote push unavailable

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    await supabase.rpc('register_device_token', {
      p_token: token,
      p_platform: Platform.OS,
      p_locale: currentLocale(),
    });
  } catch (e) {
    if (__DEV__) console.warn('push registration skipped:', (e as Error).message);
  }
}

/**
 * Register on sign-in (once per user) and route a notification tap to the same
 * destination as its in-app feed row. Mount once in the signed-in tree.
 */
export function usePushNotifications(userId: string | undefined): void {
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || registeredFor.current === userId) return;
    registeredFor.current = userId;
    void registerForPushNotifications();
  }, [userId]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        type?: NotificationType;
        entity_id?: string | null;
      };
      if (!data?.type) return;
      // notificationHref only reads type / entity_id / params — a minimal row is enough.
      const href = notificationHref({
        type: data.type,
        entity_id: data.entity_id ?? null,
        params: {},
      } as NotificationRow);
      if (href) router.push(href);
    });
    return () => sub.remove();
  }, []);
}

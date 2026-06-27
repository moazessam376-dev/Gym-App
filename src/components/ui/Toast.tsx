// Lightweight, in-house toast (no dependency — built on Reanimated, which is already
// installed). One transient message at a time, bottom-anchored above the home
// indicator (clears native headers), auto-dismiss + tap-to-dismiss. i18n-agnostic:
// the caller passes an already-translated string, so this never hardcodes copy.
//
// Usage: wrap the app once in <ToastProvider>, then in any screen:
//   const toast = useToast();
//   toast.show(t('common.saved'));            // success (default)
//   toast.show(t('common.saveFailed'), 'error');
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { theme } from '../../theme';

export type ToastTone = 'success' | 'error' | 'info';
type ToastItem = { id: number; message: string; tone: ToastTone };

type ToastApi = { show: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi | null>(null);

/** Show a transient toast from any screen under <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

const TONE: Record<ToastTone, { icon: IconName; color: string }> = {
  success: { icon: 'check-circle', color: theme.colors.success },
  error: { icon: 'x-circle', color: theme.colors.danger },
  info: { icon: 'bell', color: theme.colors.primary },
};

const VISIBLE_MS = 2800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const idRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++idRef.current;
    setToast({ id, message, tone });
    timer.current = setTimeout(() => {
      // Only clear if this exact toast is still showing (a newer one supersedes it).
      setToast((cur) => (cur?.id === id ? null : cur));
    }, VISIBLE_MS);
  }, []);

  const tone = toast ? TONE[toast.tone] : null;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && tone ? (
        <Animated.View
          key={toast.id}
          entering={FadeInUp.duration(220)}
          exiting={FadeOutDown.duration(180)}
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: insets.bottom + 24,
            alignItems: 'center',
            paddingHorizontal: theme.spacing.lg,
          }}
        >
          <Pressable
            onPress={dismiss}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              maxWidth: 480,
              backgroundColor: theme.colors.surfaceElevated,
              borderWidth: 1,
              borderColor: tone.color,
              borderRadius: theme.radii.md,
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.lg,
            }}
          >
            <Icon name={tone.icon} size={18} color={tone.color} />
            <Text variant="body" style={{ flexShrink: 1 }}>
              {toast.message}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

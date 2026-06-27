// First-run tour (Slice H2) — a once-only role-aware welcome carousel shown the first
// time a signed-in member reaches the app. A "seen" flag lives in local prefs
// (SecureStore native / localStorage web, NON-sensitive — see src/lib/prefs.ts), so it
// shows once per device and never again. Rendered by the root navigator AFTER the boot
// splash settles. Kept deliberately simple (index-based slides, not anchored coachmarks)
// so it's robust across screen sizes + RTL and doesn't gate the pilot.
import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getPref, setPref } from '@/lib/prefs';
import type { IconName } from '@/components/ui/Icon';
import { Icon, Text, Button } from '@/components/ui';
import { theme } from '@/theme';

type Slide = { icon: IconName; title: string; body: string };
type TourRole = 'client' | 'coach';

const PREF_KEY = (role: TourRole) => `raptor.tour.v1.${role}`;

function slidesFor(role: TourRole, t: (k: string) => string): Slide[] {
  if (role === 'coach') {
    return [
      { icon: 'zap', title: t('tour.coach.welcomeTitle'), body: t('tour.coach.welcomeBody') },
      { icon: 'users', title: t('tour.coach.clientsTitle'), body: t('tour.coach.clientsBody') },
      { icon: 'clipboard', title: t('tour.coach.plansTitle'), body: t('tour.coach.plansBody') },
      { icon: 'bar-chart', title: t('tour.coach.performanceTitle'), body: t('tour.coach.performanceBody') },
    ];
  }
  return [
    { icon: 'zap', title: t('tour.client.welcomeTitle'), body: t('tour.client.welcomeBody') },
    { icon: 'dumbbell', title: t('tour.client.trainTitle'), body: t('tour.client.trainBody') },
    { icon: 'trending-up', title: t('tour.client.trackTitle'), body: t('tour.client.trackBody') },
    { icon: 'message-square', title: t('tour.client.coachTitle'), body: t('tour.client.coachBody') },
  ];
}

export function FirstRunTour({ role }: { role: string | null }) {
  const { t } = useTranslation();
  const tourRole: TourRole | null = role === 'coach' ? 'coach' : role === 'client' ? 'client' : null;

  // 'checking' until the pref is read (so nothing flashes); then 'visible' or 'hidden'.
  const [status, setStatus] = useState<'checking' | 'visible' | 'hidden'>('checking');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let active = true;
    if (!tourRole) {
      setStatus('hidden');
      return;
    }
    getPref(PREF_KEY(tourRole))
      .then((seen) => {
        if (active) setStatus(seen ? 'hidden' : 'visible');
      })
      .catch(() => active && setStatus('hidden'));
    return () => {
      active = false;
    };
  }, [tourRole]);

  if (status !== 'visible' || !tourRole) return null;

  const slides = slidesFor(tourRole, t);
  const slide = slides[index]!;
  const isLast = index === slides.length - 1;

  const finish = () => {
    setStatus('hidden');
    setPref(PREF_KEY(tourRole), '1').catch(() => {});
  };
  const next = () => (isLast ? finish() : setIndex((i) => i + 1));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={finish} statusBarTranslucent>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.7)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 420,
            backgroundColor: theme.colors.surfaceElevated,
            borderRadius: theme.radii.xl,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
            padding: theme.spacing.xl,
            gap: theme.spacing.lg,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: theme.radii.full,
              backgroundColor: theme.colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={slide.icon} size={34} color={theme.colors.primary} />
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="h1" align="center">
              {slide.title}
            </Text>
            <Text variant="body" muted align="center">
              {slide.body}
            </Text>
          </View>

          {/* Progress dots */}
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
            {slides.map((_, i) => (
              <View
                key={i}
                style={{
                  width: i === index ? 22 : 8,
                  height: 8,
                  borderRadius: theme.radii.full,
                  backgroundColor: i <= index ? theme.colors.primary : theme.colors.glassBorder,
                }}
              />
            ))}
          </View>

          {/* Footer */}
          <View style={{ width: '100%', gap: theme.spacing.sm }}>
            <Button title={isLast ? t('tour.getStarted') : t('common.next')} onPress={next} size="lg" />
            {!isLast ? (
              <Pressable onPress={finish} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: theme.spacing.sm }}>
                <Text variant="caption" muted>
                  {t('tour.skip')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

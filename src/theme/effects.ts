// Gradients + glow for the "Neon Glassy Dark" look. Gradients are tuples consumed
// by expo-linear-gradient; glow() returns a colored-shadow style (the soft neon
// halo on cards/stats). Web maps shadow* to box-shadow; iOS uses native shadow;
// Android approximates with elevation.
import type { ViewStyle } from 'react-native';

export const gradients = {
  // App background — deep navy/indigo with a faint glow lift toward the top.
  screen: ['#141B3A', '#0A0E20', '#070A18'] as const,
  // Featured / hero card — blue-tinted glass (matches Тихий режим / FRQNCY).
  hero: ['#1E2A66', '#141A35'] as const,
  // Electric-blue accent fill for primary stats / CTAs.
  accent: ['#3D5AFE', '#6E8BFF'] as const,
  // Cool data gradient (blue → violet) for charts / progress.
  data: ['#3D5AFE', '#7C5CFF'] as const,
  // Subtle elevated glass card sheen.
  glass: ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.02)'] as const,
} as const;

export type GradientKey = keyof typeof gradients;

/** Soft neon glow as a shadow. Pass an accent color + optional radius. */
export function glow(color: string, radius = 16, opacity = 0.45): ViewStyle {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: 0 },
    elevation: Math.round(radius / 2),
  };
}

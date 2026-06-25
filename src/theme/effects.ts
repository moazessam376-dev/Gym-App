// Raptor effects. The brand is FLAT premium — no glassy gradients, no ambient neon
// glow on chrome. Gradients are kept (the components import them) but flattened to
// near-solid onyx. Glow is reserved for tier crests + the rank-up moment only.
// Drop-in for src/theme/effects.ts.
import type { ViewStyle } from 'react-native';

export const gradients = {
  // App background — essentially flat onyx with a barely-there lift.
  screen: ['#0E0F14', '#0A0B0F', '#08090C'] as const,
  // Featured / hero — a subtle cyan-tinted near-black (used sparingly, e.g. rank card).
  hero: ['#13212B', '#0E0F14'] as const,
  // Accent fill for primary CTAs / stats.
  accent: ['#3FD9C0', '#2BA897'] as const,
  // Cool data gradient (cyan → cobalt) for charts / progress.
  data: ['#3FD9C0', '#6B8AFF'] as const,
  // Near-invisible sheen (kept so GlassCard's gradient prop is valid).
  glass: ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.02)'] as const,
} as const;

export type GradientKey = keyof typeof gradients;

/**
 * Colored-shadow glow. DEFAULT IS OFF (opacity 0) so the flat premium look holds
 * everywhere by default. Opt in only for tier crests and the rank-up moment, e.g.
 *   glow(theme.colors.tier.apex, 24, 0.55)
 */
export function glow(color: string, radius = 16, opacity = 0): ViewStyle {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: 0 },
    elevation: opacity > 0 ? Math.round(radius / 2) : 0,
  };
}

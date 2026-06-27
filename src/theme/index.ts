// Single import surface for the design system: `import { theme } from '@/theme'`.
import { darkColors, tier } from './colors';
import { spacing } from './spacing';
import { radii } from './radii';
import { fontFamily, textVariants } from './typography';
import { gradients, glow } from './effects';
import { motion } from './motion';

export const theme = {
  colors: darkColors,
  tier,
  spacing,
  radii,
  fontFamily,
  textVariants,
  gradients,
  glow,
  motion,
} as const;

export type Theme = typeof theme;

export { darkColors, palette, tier, gradientFor, avatarGradients } from './colors';
export type { AppColors, Tier } from './colors';
export { spacing } from './spacing';
export { radii } from './radii';
export { fontFamily, textVariants } from './typography';
export type { TextVariant } from './typography';
export { gradients, glow } from './effects';
export type { GradientKey } from './effects';
export { motion } from './motion';

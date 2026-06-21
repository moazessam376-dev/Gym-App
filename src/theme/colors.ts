// "Midnight Blue" palette — Neon Glassy Dark in the blue family (refs: Тихий
// режим, FRQNCY). Deep navy base, electric-blue accent, glowing rings, glassy
// rounded cards. Dark-only for now, structured so a light theme can be added later.
//
// Accessibility: electric blue reads well on the navy bg as an accent and as a
// button fill (white text on blue). Body text is `text`/`textMuted`.

export const palette = {
  // Raw brand colors
  navy: '#0A0E20',
  surface: '#141A30',
  surfaceElevated: '#1C2342',
  blue: '#3D5AFE', // electric / royal blue — the primary accent
  blueBright: '#6E8BFF', // lighter blue for glow / highlights
  violet: '#7C5CFF',
  white: '#FFFFFF',
  muted: '#8B93AD',
  success: '#00E676',
  danger: '#FF3D71',
  warning: '#FFB020',
} as const;

export const darkColors = {
  // Backgrounds — deep navy/indigo (the screen gradient adds the soft glow).
  bg: palette.navy,
  surface: palette.surface,
  surfaceElevated: palette.surfaceElevated,
  overlay: 'rgba(6,8,18,0.7)',

  // Glassy translucent surfaces (sit over the screen gradient).
  glass: 'rgba(255,255,255,0.05)',
  glassStrong: 'rgba(255,255,255,0.08)',
  glassBorder: 'rgba(255,255,255,0.10)',

  // Borders / dividers
  border: '#232A45',
  borderStrong: '#39426B',

  // Brand / accents
  primary: palette.blue,
  primaryGlow: palette.blueBright,
  onPrimary: palette.white, // white text/icon ON the blue fill
  secondary: palette.violet,
  onSecondary: palette.white,

  // Text
  text: palette.white,
  textMuted: palette.muted,
  textOnSurface: palette.white,
  link: palette.blue,
  white: palette.white,

  // Status
  success: palette.success,
  danger: palette.danger,
  warning: palette.warning,

  // Plan status (folds in the old src/lib/plan-ui.ts PLAN_STATUS_STYLE)
  statusDraft: palette.warning,
  statusPublished: palette.success,
  statusArchived: palette.muted,
} as const;

export type AppColors = typeof darkColors;

// Gradient pairs for avatars / hero accents — cool blue/violet/cyan family for
// cohesion with the blue theme. Deterministic pick by initial.
export const avatarGradients: readonly [string, string][] = [
  ['#3D5AFE', '#7C5CFF'],
  ['#00B0FF', '#3D5AFE'],
  ['#7C5CFF', '#3D5AFE'],
  ['#2E5BFF', '#00C2FF'],
  ['#5B8DEF', '#7C5CFF'],
  ['#00C2FF', '#3D5AFE'],
];

/** Stable gradient for a name/seed so the same person always looks the same. */
export function gradientFor(seed: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarGradients[h % avatarGradients.length];
}

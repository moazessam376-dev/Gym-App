// Raptor — "Onyx Premium" palette. Replaces the old "Midnight Blue" theme.
// Flat near-black canvas + one electric Signal cyan accent. Dark-only for now,
// structured so a light theme can be added later. Drop-in for src/theme/colors.ts
// (every key the app already reads is preserved — this is a value swap, not a rename).

export const palette = {
  // Raw brand colors
  onyx: '#0A0B0F', // page background
  slate: '#15161D', // cards / surfaces
  raise: '#1F2029', // elevated surfaces
  edge: '#2A2B38', // borders / dividers
  edgeStrong: '#3A3D4C',
  cloud: '#F5F6F8', // primary text (off-white)
  mist: '#9B9CA8', // secondary text
  faint: '#5C616E', // tertiary / disabled

  signal: '#3FD9C0', // THE accent — primary CTA, rank-up, highlights (~80% of accent use)
  signalBright: '#9BFFEE', // glow / highlight only
  cobalt: '#6B8AFF', // secondary data series in charts — never UI chrome
  ember: '#FF6B4A', // alerts, errors, rank-down
  amber: '#FFB323', // warnings / draft
  positive: '#3FD98A', // success (kept distinct from the cyan accent)
  white: '#FFFFFF',
} as const;

export const darkColors = {
  // Backgrounds — flat onyx (no screen gradient lift; see effects.ts).
  bg: palette.onyx,
  surface: palette.slate,
  surfaceElevated: palette.raise,
  overlay: 'rgba(5,6,9,0.72)',

  // "Glass" surfaces are now flat slate so GlassCard matches Card (premium = flat,
  // not translucent). Keeps the GlassCard component working with no code change.
  glass: palette.slate,
  glassStrong: palette.raise,
  glassBorder: palette.edge,

  // Borders / dividers
  border: palette.edge,
  borderStrong: palette.edgeStrong,

  // Brand / accents
  primary: palette.signal,
  primaryGlow: palette.signalBright,
  onPrimary: palette.onyx, // dark text/icon ON the cyan fill (NOT white)
  secondary: palette.cobalt,
  onSecondary: palette.onyx,

  // Text
  text: palette.cloud,
  textMuted: palette.mist,
  textOnSurface: palette.cloud,
  link: palette.signal,
  white: palette.white,

  // Status
  success: palette.positive,
  danger: palette.ember,
  warning: palette.amber,

  // Plan status
  statusDraft: palette.amber,
  statusPublished: palette.positive,
  statusArchived: palette.mist,
} as const;

export type AppColors = typeof darkColors;

// Tier colors — the 8-tier ranking ramp (Bronze → Apex). Use these everywhere a
// tier is shown (badge, leaderboard row, rank-up). NEVER hardcode tier hex values.
export const tier = {
  bronze: '#B07A42',
  silver: '#9AA3AF',
  gold: '#E5B83C',
  platinum: '#CFE6F0',
  diamond: '#6B8AFF',
  master: '#9B7BF5',
  grandmaster: '#E0556B',
  apex: '#3FD9C0', // the apex predator owns the brand accent
} as const;

export type Tier = keyof typeof tier;

// Avatar gradients — cool teal/steel/cobalt family for cohesion with the cyan accent.
export const avatarGradients: readonly [string, string][] = [
  ['#3FD9C0', '#2BA897'],
  ['#6B8AFF', '#3FD9C0'],
  ['#3FD9C0', '#1A8A78'],
  ['#8FA8C4', '#3FD9C0'],
  ['#6B8AFF', '#9B7BF5'],
  ['#3FD9C0', '#6B8AFF'],
];

/** Stable gradient for a name/seed so the same person always looks the same. */
export function gradientFor(seed: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarGradients[h % avatarGradients.length];
}

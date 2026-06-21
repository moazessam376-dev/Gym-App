// Corner radii. Cards lean generous; pills use `full`.
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export type RadiusKey = keyof typeof radii;

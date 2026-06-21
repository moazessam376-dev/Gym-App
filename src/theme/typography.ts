// Type system. Display = Space Grotesk (headers, ranks, big numbers); body = Inter.
// Font family keys match what @expo-google-fonts exports and what `useFonts` loads
// in app/_layout.tsx — keep these strings in sync with the fontMap there.

export const fontFamily = {
  // Space Grotesk — display / numeric
  displayRegular: 'SpaceGrotesk_400Regular',
  displayMedium: 'SpaceGrotesk_500Medium',
  displaySemiBold: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  // Inter — body / UI
  bodyRegular: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
} as const;

export type TextVariant =
  | 'display' // hero numbers / screen heroes
  | 'h1'
  | 'h2'
  | 'title'
  | 'body'
  | 'bodyStrong'
  | 'label' // small all-caps tags / overlines
  | 'caption';

type VariantStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase';
};

export const textVariants: Record<TextVariant, VariantStyle> = {
  display: { fontFamily: fontFamily.displayBold, fontSize: 40, lineHeight: 44, letterSpacing: -0.5 },
  h1: { fontFamily: fontFamily.displayBold, fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
  h2: { fontFamily: fontFamily.displaySemiBold, fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  title: { fontFamily: fontFamily.displayMedium, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fontFamily.bodyRegular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fontFamily.bodySemiBold, fontSize: 15, lineHeight: 22 },
  label: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  caption: { fontFamily: fontFamily.bodyRegular, fontSize: 13, lineHeight: 18 },
};

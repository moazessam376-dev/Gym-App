// Raptor type system. Display/headlines = Geist; body/UI = Inter; ALL data
// (numbers, stats, ranks, %) = JetBrains Mono. Drop-in for src/theme/typography.ts.
//
// IMPORTANT: the font-family strings below must match the keys loaded by `useFonts`
// in app/_layout.tsx. After swapping this file, update that fontMap (see RESKIN.md):
//   - replace the SpaceGrotesk_* entries with the Geist_* ones
//   - add the JetBrainsMono_* entries
//   - keep the Inter_* entries

export const fontFamily = {
  // Geist — display / headlines / wordmark
  displayRegular: 'Geist_400Regular',
  displayMedium: 'Geist_500Medium',
  displaySemiBold: 'Geist_600SemiBold',
  displayBold: 'Geist_700Bold',
  displayBlack: 'Geist_900Black',
  // Inter — body / UI
  bodyRegular: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  // JetBrains Mono — every number
  monoRegular: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

export type TextVariant =
  | 'display' // big hero NUMBERS (kcal, %, streak) — mono on purpose
  | 'h1'
  | 'h2'
  | 'title'
  | 'body'
  | 'bodyStrong'
  | 'label' // small all-caps overlines
  | 'caption'
  | 'mono'; // NEW — inline stats / data labels (use anywhere a number appears)

type VariantStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase';
};

export const textVariants: Record<TextVariant, VariantStyle> = {
  // `display` is mono because in this app it's almost always a number (the brand
  // rule: every number is mono). Screen-title TEXT should use h1, not display.
  display: { fontFamily: fontFamily.monoBold, fontSize: 44, lineHeight: 48, letterSpacing: -1 },
  h1: { fontFamily: fontFamily.displayBold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  h2: { fontFamily: fontFamily.displaySemiBold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  title: { fontFamily: fontFamily.displaySemiBold, fontSize: 19, lineHeight: 25, letterSpacing: -0.2 },
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
  mono: { fontFamily: fontFamily.monoMedium, fontSize: 13, lineHeight: 18, letterSpacing: 0.2 },
};

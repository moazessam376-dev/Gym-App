// Responsive breakpoint hook for the web build. The coach desktop portal (sidebar
// shell) turns on at WIDE_BREAKPOINT; below that — and on ALL native — the app keeps
// its phone bottom-tab layout. Kept separate from the existing in-screen content
// breakpoint (`performance.tsx` uses `width >= 900` for column counts) on purpose.
import { Platform, useWindowDimensions } from 'react-native';

export const WIDE_BREAKPOINT = 1024; // ≥ this (web) → desktop sidebar shell
export const TABLET_BREAKPOINT = 768; // 768–1024 (web) → still tabs in W0 (future: icon rail)
export const SIDEBAR_WIDTH = 220; // from the mockup
export const CONTENT_MAX_WIDTH = 1240; // from the mockup
export const TOPBAR_HEIGHT = 64;

export type Breakpoint = {
  width: number;
  isWide: boolean;
  isTablet: boolean;
  isPhone: boolean;
};

export function useBreakpoint(): Breakpoint {
  const { width: rnWidth } = useWindowDimensions();
  // `output: static` prerenders with no `window`, so useWindowDimensions can yield 0
  // on the first frame. Seed from window.innerWidth on web so the first CLIENT render
  // already has the real width, and treat unknown/0 as narrow → a desktop never flashes
  // a sidebar that then collapses (no hydration thrash).
  const width = rnWidth || (typeof window !== 'undefined' ? window.innerWidth : 0);
  const isWide = Platform.OS === 'web' && width >= WIDE_BREAKPOINT;
  const isTablet = Platform.OS === 'web' && width >= TABLET_BREAKPOINT && width < WIDE_BREAKPOINT;
  const isPhone = !isWide && !isTablet;
  return { width, isWide, isTablet, isPhone };
}

/** True only on a wide WEB viewport (the coach desktop-shell switch). */
export function useIsWideWeb(): boolean {
  return useBreakpoint().isWide;
}

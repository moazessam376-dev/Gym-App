// RTL-aware helpers (Phase 16). `I18nManager.isRTL` is fixed for the lifetime of a JS
// bundle and only changes after a reload — which the language switcher forces — so
// reading it at render time is correct. Vector icons (Ionicons) don't auto-mirror under
// RTL, so a "drill-in / next" chevron has to be picked by writing direction.
import { I18nManager, type TextStyle } from 'react-native';

/** The chevron pointing "forward" in the current direction (→ in LTR, ← in RTL). Use for
 *  drill-in rows / "go deeper" affordances so they point the natural way in Arabic. */
export function forwardChevron(): 'chevron-forward' | 'chevron-back' {
  return I18nManager.isRTL ? 'chevron-back' : 'chevron-forward';
}

/** textAlign that follows the writing direction's START (RN's `textAlign` has no logical
 *  `start`/`end`, and LATIN text inside an RTL screen left-aligns by default — which makes a
 *  name hug a far-side avatar). Apply to header text so it aligns right under Arabic. */
export const textStart: TextStyle = { textAlign: I18nManager.isRTL ? 'right' : 'left' };

// Motion tokens — keep screen/tab transitions consistent and tunable in one place.
// Durations are deliberately short so movement reads as responsive, never sluggish.
// `screen` is a native-stack animation; RTL is auto-mirrored by react-native-screens
// off I18nManager, so 'slide_from_right' becomes a left-slide in Arabic for free.
export const motion = {
  /** Native-stack push/pop animation for full-screen routes. */
  screen: 'slide_from_right' as const,
  /** Push/pop duration (ms). */
  screenMs: 220,
  /** Bottom-tab switch animation (subtle cross-shift, not a hard cut). */
  tab: 'shift' as const,
};

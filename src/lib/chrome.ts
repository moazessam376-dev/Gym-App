// Coach web-portal "chrome" context. Set to { active: true } ONLY inside
// CoachWebChrome when the desktop sidebar shell is mounted (wide web + coach role).
// `Screen` reads this to switch to a centered, capped, no-safe-area desktop layout.
// Kept as a leaf module (no UI imports) so `Screen` can consume it without an
// import cycle through the ui barrel.
import { createContext, useContext } from 'react';

export type ChromeState = { active: boolean };

export const ChromeContext = createContext<ChromeState>({ active: false });

export const useChrome = () => useContext(ChromeContext);

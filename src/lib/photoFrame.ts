// Shared framing math for transformation photos, so the editor's live preview and the
// rendered card apply an identical crop. A PhotoFrame is a uniform `scale` (>=1) + a pan
// `x`/`y` in [-1,1]. Given a measured cell (w×h) — and, when known, the photo's NATURAL
// size — returns the absolute style that positions the image so it covers the cell,
// zoomed by `scale` and panned within the overflow. x=-1/+1 pins the left/right edge
// (y=-1/+1 top/bottom); 0 = centered.
//
// With the natural size, the box keeps the image's aspect ratio, so a non-square photo
// already overflows a square cell at scale 1 — panning works WITHOUT zooming (the
// founder's "zoom-only framing is impractical" fix). Without it (not yet loaded /
// legacy callers) the box falls back to cell-aspect × scale, which is only pannable
// after zooming. Editor + card MUST use these two functions.
import type { ImageStyle } from 'react-native';
import type { PhotoFrame } from './public-profiles';

export type NaturalSize = { w: number; h: number };

// Zoom bounds. scale < 1 zooms OUT below cover — the photo letterboxes inside the cell
// (bars in the cell background), like WhatsApp's move & scale. 0.4 is far enough to see
// any whole photo; 3 is the crop ceiling.
export const MIN_FRAME_SCALE = 0.4;
export const MAX_FRAME_SCALE = 3;

export function clampScale(s: number): number {
  return Math.max(MIN_FRAME_SCALE, Math.min(MAX_FRAME_SCALE, Math.round(s * 1000) / 1000));
}

/** The cover-fit box (image aspect preserved, fully covering the cell) at `scale`. */
function coverBox(w: number, h: number, scale: number, nat?: NaturalSize | null): { bw: number; bh: number } {
  if (nat && nat.w > 0 && nat.h > 0) {
    const imgAR = nat.w / nat.h;
    const cellAR = w / h;
    return imgAR > cellAR
      ? { bw: h * imgAR * scale, bh: h * scale } // wider than cell → horizontal overflow
      : { bw: w * scale, bh: (w / imgAR) * scale }; // taller → vertical overflow
  }
  return { bw: w * scale, bh: h * scale };
}

export function frameStyle(
  frame: PhotoFrame | null | undefined,
  w: number,
  h: number,
  nat?: NaturalSize | null,
): ImageStyle {
  if (w <= 0 || h <= 0) {
    return { position: 'absolute', left: 0, top: 0, width: undefined, height: undefined };
  }
  const f = frame ?? { scale: 1, x: 0, y: 0 };
  const scale = Math.max(0.2, f.scale); // defensive floor on stored values
  const { bw, bh } = coverBox(w, h, scale, nat);
  const ox = (bw - w) / 2; // horizontal overflow each side when centered
  const oy = (bh - h) / 2;
  // An axis with NO overflow (zoomed out below cover) is centered — pan doesn't apply.
  return {
    position: 'absolute',
    width: bw,
    height: bh,
    left: ox > 0 ? -ox * (1 + f.x) : -ox,
    top: oy > 0 ? -oy * (1 + f.y) : -oy,
  };
}

/** Convert a drag delta (px) within a cell into a new normalized pan, so the image follows
 *  the finger. Uses the same overflow basis as frameStyle. */
export function panBy(
  frame: PhotoFrame,
  dx: number,
  dy: number,
  w: number,
  h: number,
  nat?: NaturalSize | null,
): PhotoFrame {
  if (w <= 0 || h <= 0) return frame;
  const { bw, bh } = coverBox(w, h, Math.max(1, frame.scale), nat);
  const ox = (bw - w) / 2;
  const oy = (bh - h) / 2;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    scale: frame.scale,
    x: ox > 0 ? clamp(frame.x - dx / ox) : frame.x,
    y: oy > 0 ? clamp(frame.y - dy / oy) : frame.y,
  };
}

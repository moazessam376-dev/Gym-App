// Shared framing math for transformation photos, so the editor's live preview and the
// rendered card apply an identical crop. A PhotoFrame is a uniform `scale` (>=1) + a pan
// `x`/`y` in [-1,1]. Given a measured cell (w×h), returns the absolute style that positions a
// `cover` image so it's zoomed by `scale` and panned within the cell. x=-1/​+1 pins the
// left/right edge (y=-1/+1 top/bottom); 0 = centered. Editor + card MUST use this one function.
import type { ImageStyle } from 'react-native';
import type { PhotoFrame } from './public-profiles';

export function frameStyle(frame: PhotoFrame | null | undefined, w: number, h: number): ImageStyle {
  if (!frame || frame.scale <= 1.001 || w <= 0 || h <= 0) {
    return { position: 'absolute', left: 0, top: 0, width: w > 0 ? w : undefined, height: h > 0 ? h : undefined };
  }
  const iw = w * frame.scale;
  const ih = h * frame.scale;
  const ox = (iw - w) / 2; // horizontal overflow each side when centered
  const oy = (ih - h) / 2;
  return { position: 'absolute', width: iw, height: ih, left: -ox * (1 + frame.x), top: -oy * (1 + frame.y) };
}

/** Convert a drag delta (px) within a cell into a new normalized pan, so the image follows the
 *  finger. Uses the same overflow basis as frameStyle. */
export function panBy(frame: PhotoFrame, dx: number, dy: number, w: number, h: number): PhotoFrame {
  const ox = (w * frame.scale - w) / 2;
  const oy = (h * frame.scale - h) / 2;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    scale: frame.scale,
    x: ox > 0 ? clamp(frame.x - dx / ox) : frame.x,
    y: oy > 0 ? clamp(frame.y - dy / oy) : frame.y,
  };
}

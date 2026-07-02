// One gesture recognizer for every photo-framing surface (card cells, the slider's
// selected photo, the Move & Scale panel, the desktop slot pickers):
//   1 finger  → pan the photo within its overflow (panBy)
//   2 fingers → PINCH to zoom in/out (scale clamped to [MIN_FRAME_SCALE, MAX_FRAME_SCALE])
// and, critically for phones: it REFUSES responder termination and blocks the native
// responder, then reports grant/release via onActive so the host screen can freeze its
// ScrollView — otherwise a not-perfectly-straight drag scrolls the page mid-gesture
// (the founder's "moving the picture scrolls the screen" bug).
//
// All inputs are getter callbacks (not values) so one responder instance — PanResponders
// must be created once — always reads current state.
import { PanResponder, type GestureResponderEvent, type PanResponderInstance } from 'react-native';
import type { PhotoFrame } from './public-profiles';
import { clampScale, panBy, type NaturalSize } from './photoFrame';

type Touch = { pageX: number; pageY: number };

function touchDistance(touches: Touch[]): number {
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}

export function createFrameGesture(refs: {
  frame: () => PhotoFrame;
  size: () => { w: number; h: number };
  nat: () => NaturalSize | null;
  onFrame: (f: PhotoFrame) => void;
  /** Fired on touch-down / release so the host can toggle its ScrollView's scrollEnabled. */
  onActive?: (active: boolean) => void;
}): PanResponderInstance {
  let startFrame: PhotoFrame = { scale: 1, x: 0, y: 0 };
  // After a pinch ends with one finger still down, the pan baseline rebases here so the
  // accumulated gestureState dx/dy from the pinch phase doesn't jump the photo.
  let panBase = { dx: 0, dy: 0 };
  let pinching = false;
  let pinchDist0 = 0;
  let pinchScale0 = 1;

  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Never yield to the enclosing ScrollView (JS side) or native gesture (Android).
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => {
      startFrame = refs.frame();
      panBase = { dx: 0, dy: 0 };
      pinching = false;
      refs.onActive?.(true);
    },
    onPanResponderMove: (e: GestureResponderEvent, g) => {
      const touches = e.nativeEvent.touches as unknown as Touch[];
      if (touches.length >= 2) {
        const d = touchDistance(touches);
        if (!pinching) {
          pinching = true;
          pinchDist0 = d;
          pinchScale0 = refs.frame().scale;
        } else if (pinchDist0 > 0) {
          refs.onFrame({ ...refs.frame(), scale: clampScale(pinchScale0 * (d / pinchDist0)) });
        }
        return;
      }
      if (pinching) {
        // Pinch → single-finger pan: rebase so the photo doesn't jump.
        pinching = false;
        startFrame = refs.frame();
        panBase = { dx: g.dx, dy: g.dy };
      }
      const { w, h } = refs.size();
      refs.onFrame(panBy(startFrame, g.dx - panBase.dx, g.dy - panBase.dy, w, h, refs.nat()));
    },
    onPanResponderRelease: () => refs.onActive?.(false),
    onPanResponderTerminate: () => refs.onActive?.(false),
  });
}

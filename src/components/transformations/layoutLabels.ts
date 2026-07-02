// Layout → i18n label key. An explicit map (not a template string) so the parity check and
// grep-ability stay honest (i18n rule: enum→dict lookups must match keys verbatim).
import type { TransformationLayout } from '@/lib/public-profiles';

export const LAYOUT_LABEL_KEY: Record<TransformationLayout, string> = {
  side: 'transformationEditor.layoutSide',
  stack: 'transformationEditor.layoutStack',
  slider: 'transformationEditor.layoutSlider',
  strip: 'transformationEditor.layoutStrip',
  grid: 'transformationEditor.layoutGrid',
};

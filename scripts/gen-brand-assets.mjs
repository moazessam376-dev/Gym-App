// Generates the Raptor native brand assets (app icon, adaptive icon, splash,
// favicon) from the "R." monogram + "Raptor." wordmark, rendered in Geist 900 with
// the Signal-cyan trailing dot. Run: `node scripts/gen-brand-assets.mjs`.
// Re-run whenever the brand colors / wordmark change. Output → ./assets/*.png.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const GEIST_900 = resolve(root, 'node_modules/@expo-google-fonts/geist/900Black/Geist_900Black.ttf');
const OUT = resolve(root, 'assets');
mkdirSync(OUT, { recursive: true });

const ONYX = '#0A0B0F';
const CLOUD = '#F5F6F8';
const SIGNAL = '#3FD9C0';

const fontOpts = { fontFiles: [GEIST_900], loadSystemFonts: false, defaultFontFamily: 'Geist' };

function render(svg, width) {
  const r = new Resvg(svg, { font: fontOpts, fitTo: { mode: 'width', value: width } });
  return r.render().asPng();
}

// "R." monogram centered. `bg` null → transparent (adaptive foreground / splash).
function monogramSvg({ size, bg, fontScale = 0.62, cornerRadius = 0 }) {
  const fs = Math.round(size * fontScale);
  const cy = size / 2 + fs * 0.34; // optical baseline for centered caps
  const bgRect = bg
    ? `<rect width="${size}" height="${size}" rx="${cornerRadius}" fill="${bg}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bgRect}
  <text x="50%" y="${cy}" text-anchor="middle" font-family="Geist" font-weight="900" font-size="${fs}" letter-spacing="${-fs * 0.04}"><tspan fill="${CLOUD}">R</tspan><tspan fill="${SIGNAL}">.</tspan></text>
</svg>`;
}

// "Raptor." wordmark centered on a transparent canvas, for the splash (sits on the
// onyx splash backgroundColor set in app.json).
function wordmarkSvg({ width, height }) {
  const fs = Math.round(height * 0.16);
  const cy = height / 2 + fs * 0.34;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <text x="50%" y="${cy}" text-anchor="middle" font-family="Geist" font-weight="900" font-size="${fs}" letter-spacing="${-fs * 0.04}"><tspan fill="${CLOUD}">Raptor</tspan><tspan fill="${SIGNAL}">.</tspan></text>
</svg>`;
}

const jobs = [
  // iOS/store icon — full-bleed onyx square (OS masks the corners).
  ['icon.png', render(monogramSvg({ size: 1024, bg: ONYX, fontScale: 0.6 }), 1024)],
  // Android adaptive foreground — transparent, glyph kept inside the ~66% safe zone.
  ['adaptive-icon.png', render(monogramSvg({ size: 1024, bg: null, fontScale: 0.42 }), 1024)],
  // Splash — wordmark on transparent (onyx background comes from app.json splash config).
  ['splash.png', render(wordmarkSvg({ width: 1242, height: 1242 }), 1242)],
  // Web favicon.
  ['favicon.png', render(monogramSvg({ size: 196, bg: ONYX, fontScale: 0.6 }), 196)],
];

for (const [name, png] of jobs) {
  writeFileSync(resolve(OUT, name), png);
  console.log('wrote', `assets/${name}`, `(${png.length} bytes)`);
}

export const DEFAULT_THEME_COLOR = '#ffc0cb';

export const THEME_PRESETS = [
  { id: 'blossom-pink', label: 'Blossom Pink', color: '#ffc0cb' },
  { id: 'peach-sorbet', label: 'Peach Sorbet', color: '#ffcfb3' },
  { id: 'lavender-milk', label: 'Lavender Milk', color: '#d9c7ff' },
  { id: 'mint-macaroon', label: 'Mint Macaroon', color: '#bfe8d5' },
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeHex(hex) {
  const stripped = `${hex}`.trim().replace('#', '');
  if (stripped.length === 3) {
    return `#${stripped
      .split('')
      .map((value) => `${value}${value}`)
      .join('')}`.toLowerCase();
  }

  if (stripped.length === 6) {
    return `#${stripped.toLowerCase()}`;
  }

  return DEFAULT_THEME_COLOR;
}

function hexToRgb(hex) {
  const normalized = normalizeHex(hex).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function mixColors(first, second, ratio) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  const t = clamp(ratio, 0, 1);

  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

export function buildThemeTokens(baseColor) {
  const accent = normalizeHex(baseColor);
  const accentSoft = mixColors(accent, '#ffffff', 0.74);
  const accentMuted = mixColors(accent, '#ffffff', 0.88);
  const accentStrong = mixColors(accent, '#ffffff', 0.22);
  const pageBg = mixColors(accent, '#fffafc', 0.95);
  const surface = mixColors(accent, '#ffffff', 0.94);
  const surfaceStrong = mixColors(accent, '#ffffff', 0.9);
  const surfaceMuted = mixColors(accent, '#fff7fa', 0.82);
  const border = mixColors(accent, '#ffffff', 0.68);
  const borderStrong = mixColors(accent, '#ffffff', 0.48);

  return {
    '--accent': accent,
    '--accent-soft': accentSoft,
    '--accent-muted': accentMuted,
    '--accent-strong': accentStrong,
    '--page-bg': pageBg,
    '--surface': surface,
    '--surface-strong': surfaceStrong,
    '--surface-muted': surfaceMuted,
    '--border': border,
    '--border-strong': borderStrong,
    '--text-primary': '#2f2941',
    '--text-secondary': '#6c6480',
    '--shadow-color': withAlpha(accent, 0.12),
  };
}

export function normalizeThemeColor(color) {
  return normalizeHex(color);
}

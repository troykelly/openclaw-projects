/**
 * GitHub-style color palette for labels
 */

export interface LabelColor {
  name: string;
  hex: string;
}

/**
 * Predefined colors inspired by GitHub's label colors
 */
export const LABEL_COLORS: LabelColor[] = [
  { name: 'bug', hex: '#d73a4a' },
  { name: 'documentation', hex: '#0075ca' },
  { name: 'duplicate', hex: '#cfd3d7' },
  { name: 'enhancement', hex: '#a2eeef' },
  { name: 'good first issue', hex: '#7057ff' },
  { name: 'help wanted', hex: '#008672' },
  { name: 'invalid', hex: '#e4e669' },
  { name: 'question', hex: '#d876e3' },
  { name: 'wontfix', hex: '#ffffff' },
  { name: 'priority: high', hex: '#b60205' },
  { name: 'priority: medium', hex: '#fbca04' },
  { name: 'priority: low', hex: '#0e8a16' },
  { name: 'blocked', hex: '#d93f0b' },
  { name: 'in progress', hex: '#1d76db' },
  { name: 'needs review', hex: '#5319e7' },
];

/**
 * Additional color options for custom labels
 */
export const ADDITIONAL_COLORS: string[] = [
  '#b60205', // red
  '#d93f0b', // orange
  '#fbca04', // yellow
  '#0e8a16', // green
  '#006b75', // teal
  '#1d76db', // blue
  '#0052cc', // dark blue
  '#5319e7', // purple
  '#e99695', // light red
  '#f9d0c4', // peach
  '#fef2c0', // light yellow
  '#c2e0c6', // light green
  '#bfdadc', // light teal
  '#c5def5', // light blue
  '#bfd4f2', // lavender
  '#d4c5f9', // light purple
];

/**
 * Calculate contrast color (black or white) for text on a background
 */
export function getContrastColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '');

  // Parse RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate relative luminance using sRGB
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black for light backgrounds, white for dark
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Get a random color from the palette
 */
export function getRandomColor(): string {
  const allColors = [...LABEL_COLORS.map((c) => c.hex), ...ADDITIONAL_COLORS];
  return allColors[Math.floor(Math.random() * allColors.length)];
}

/**
 * Advanced theme system with premium and professional presets
 * Includes X/Twitter-inspired designs, modern corporate looks, and creative themes
 */

export type AdvancedTheme =
  | 'x-light'
  | 'x-dark'
  | 'premium-blue'
  | 'premium-purple'
  | 'premium-teal'
  | 'corporate-slate'
  | 'minimal-air'
  | 'dark-charcoal'
  | 'sunset-gradient'
  | 'forest-deep'
  | 'ocean-wave'
  | 'bitcoin-gold'
  | 'lightning-electric';

export interface AdvancedThemeConfig {
  id: AdvancedTheme;
  name: string;
  category: 'inspired' | 'premium' | 'corporate' | 'minimal' | 'creative' | 'crypto';
  description: string;
  primaryColor: string;      // HSL format
  secondaryColor: string;    // HSL format
  accentColor: string;       // HSL format
  backgroundColor: string;   // HSL format
  textColor: string;         // HSL format
  borderColor: string;       // HSL format
  successColor: string;      // HSL format
  warningColor: string;      // HSL format
  errorColor: string;        // HSL format
}

export const ADVANCED_THEMES: Record<AdvancedTheme, AdvancedThemeConfig> = {
  // X/Twitter-inspired themes
  'x-light': {
    id: 'x-light',
    name: 'X Light',
    category: 'inspired',
    description: 'Clean X-inspired light theme with minimal distractions',
    primaryColor: '0 0% 0%',           // Black
    secondaryColor: '0 0% 15%',        // Dark gray
    accentColor: '207 89% 51%',        // Twitter blue
    backgroundColor: '0 0% 100%',      // White
    textColor: '0 0% 0%',              // Black
    borderColor: '0 0% 90%',           // Light gray
    successColor: '142 71% 41%',       // Green
    warningColor: '38 92% 50%',        // Orange
    errorColor: '0 84% 60%',           // Red
  },
  'x-dark': {
    id: 'x-dark',
    name: 'X Dark',
    category: 'inspired',
    description: 'X-inspired dark theme with high contrast',
    primaryColor: '0 0% 100%',         // White
    secondaryColor: '0 0% 90%',        // Light gray
    accentColor: '207 100% 61%',       // Bright twitter blue
    backgroundColor: '0 0% 0%',        // Pure black
    textColor: '0 0% 100%',            // White
    borderColor: '0 0% 15%',           // Dark gray
    successColor: '142 71% 51%',       // Bright green
    warningColor: '38 92% 55%',        // Bright orange
    errorColor: '0 84% 70%',           // Bright red
  },

  // Premium corporate themes
  'premium-blue': {
    id: 'premium-blue',
    name: 'Premium Blue',
    category: 'premium',
    description: 'Professional blue with gold accents for premium feel',
    primaryColor: '217 91% 60%',       // Professional blue
    secondaryColor: '217 70% 50%',     // Darker blue
    accentColor: '45 93% 56%',         // Gold
    backgroundColor: '220 20% 98%',    // Off-white
    textColor: '240 10% 4%',           // Dark blue-black
    borderColor: '220 15% 88%',        // Soft blue-gray
    successColor: '142 71% 41%',       // Professional green
    warningColor: '38 92% 45%',        // Professional orange
    errorColor: '0 84% 60%',           // Professional red
  },
  'premium-purple': {
    id: 'premium-purple',
    name: 'Premium Purple',
    category: 'premium',
    description: 'Elegant purple with silver accents for luxury feel',
    primaryColor: '263 80% 50%',       // Rich purple
    secondaryColor: '263 70% 40%',     // Darker purple
    accentColor: '0 0% 70%',           // Silver
    backgroundColor: '270 10% 97%',    // Soft lavender white
    textColor: '260 20% 8%',           // Deep purple-black
    borderColor: '270 15% 85%',        // Soft purple-gray
    successColor: '142 71% 41%',       // Green
    warningColor: '38 92% 45%',        // Orange
    errorColor: '0 84% 60%',           // Red
  },
  'premium-teal': {
    id: 'premium-teal',
    name: 'Premium Teal',
    category: 'premium',
    description: 'Modern teal with rose gold accents',
    primaryColor: '170 76% 48%',       // Vibrant teal
    secondaryColor: '170 60% 38%',     // Darker teal
    accentColor: '15 87% 60%',         // Rose gold
    backgroundColor: '170 15% 97%',    // Soft teal white
    textColor: '175 25% 8%',           // Deep teal-black
    borderColor: '170 20% 82%',        // Soft teal-gray
    successColor: '142 71% 41%',       // Green
    warningColor: '38 92% 45%',        // Orange
    errorColor: '0 84% 60%',           // Red
  },

  // Corporate themes
  'corporate-slate': {
    id: 'corporate-slate',
    name: 'Corporate Slate',
    category: 'corporate',
    description: 'Professional slate gray for serious business',
    primaryColor: '217 25% 40%',       // Slate blue
    secondaryColor: '217 30% 30%',     // Darker slate
    accentColor: '45 93% 56%',         // Gold
    backgroundColor: '217 20% 97%',    // Soft slate white
    textColor: '217 30% 10%',          // Deep slate
    borderColor: '217 15% 80%',        // Soft slate gray
    successColor: '142 65% 40%',       // Muted green
    warningColor: '38 80% 45%',        // Muted orange
    errorColor: '0 70% 55%',           // Muted red
  },

  // Minimal themes
  'minimal-air': {
    id: 'minimal-air',
    name: 'Minimal Air',
    category: 'minimal',
    description: 'Ultra-light minimal design with plenty of breathing room',
    primaryColor: '0 0% 5%',           // Almost black
    secondaryColor: '0 0% 20%',        // Dark gray
    accentColor: '200 100% 50%',       // Bright blue
    backgroundColor: '0 0% 100%',      // Pure white
    textColor: '0 0% 0%',              // Black
    borderColor: '0 0% 95%',           // Nearly white
    successColor: '120 100% 40%',      // Bright green
    warningColor: '40 100% 50%',       // Bright orange
    errorColor: '0 100% 50%',          // Bright red
  },

  // Dark themes
  'dark-charcoal': {
    id: 'dark-charcoal',
    name: 'Dark Charcoal',
    category: 'minimal',
    description: 'Deep charcoal with subtle accents, easy on the eyes',
    primaryColor: '0 0% 95%',          // Light gray
    secondaryColor: '0 0% 85%',        // Medium gray
    accentColor: '220 90% 60%',        // Sky blue
    backgroundColor: '0 0% 8%',        // Very dark
    textColor: '0 0% 95%',             // Light gray
    borderColor: '0 0% 25%',           // Dark gray
    successColor: '142 71% 51%',       // Bright green
    warningColor: '38 92% 55%',        // Bright orange
    errorColor: '0 84% 70%',           // Bright red
  },

  // Creative themes
  'sunset-gradient': {
    id: 'sunset-gradient',
    name: 'Sunset Gradient',
    category: 'creative',
    description: 'Warm sunset colors for creative energy',
    primaryColor: '18 88% 50%',        // Orange
    secondaryColor: '18 85% 40%',      // Deep orange
    accentColor: '340 80% 50%',        // Pink
    backgroundColor: '30 40% 96%',     // Warm white
    textColor: '20 30% 10%',           // Warm dark
    borderColor: '30 30% 85%',         // Warm beige
    successColor: '120 70% 45%',       // Green
    warningColor: '40 100% 50%',       // Orange
    errorColor: '0 84% 60%',           // Red
  },
  'forest-deep': {
    id: 'forest-deep',
    name: 'Forest Deep',
    category: 'creative',
    description: 'Natural forest greens with earth tones',
    primaryColor: '152 62% 32%',       // Forest green
    secondaryColor: '152 60% 22%',     // Deep forest
    accentColor: '38 92% 50%',         // Gold
    backgroundColor: '140 25% 95%',    // Soft green white
    textColor: '150 30% 10%',          // Forest dark
    borderColor: '150 20% 80%',        // Soft green gray
    successColor: '120 60% 40%',       // Green
    warningColor: '40 100% 50%',       // Orange
    errorColor: '0 84% 60%',           // Red
  },
  'ocean-wave': {
    id: 'ocean-wave',
    name: 'Ocean Wave',
    category: 'creative',
    description: 'Cool ocean blues with seafoam accents',
    primaryColor: '200 100% 40%',      // Deep ocean
    secondaryColor: '200 85% 30%',     // Darker ocean
    accentColor: '180 100% 50%',       // Seafoam
    backgroundColor: '210 30% 97%',    // Soft blue white
    textColor: '210 40% 8%',           // Ocean dark
    borderColor: '210 20% 85%',        // Soft blue gray
    successColor: '120 70% 45%',       // Green
    warningColor: '40 100% 50%',       // Orange
    errorColor: '0 84% 60%',           // Red
  },

  // Crypto-themed
  'bitcoin-gold': {
    id: 'bitcoin-gold',
    name: 'Bitcoin Gold',
    category: 'crypto',
    description: 'Bitcoin orange and gold for crypto enthusiasts',
    primaryColor: '25 100% 50%',       // Bitcoin orange
    secondaryColor: '25 100% 40%',     // Darker orange
    accentColor: '45 93% 56%',         // Gold
    backgroundColor: '25 40% 97%',     // Soft orange white
    textColor: '25 60% 15%',           // Orange dark
    borderColor: '25 30% 85%',         // Soft orange gray
    successColor: '120 70% 45%',       // Green
    warningColor: '40 100% 50%',       // Orange
    errorColor: '0 84% 60%',           // Red
  },
  'lightning-electric': {
    id: 'lightning-electric',
    name: 'Lightning Electric',
    category: 'crypto',
    description: 'Electric yellow for Lightning Network energy',
    primaryColor: '45 100% 50%',       // Electric yellow
    secondaryColor: '45 100% 40%',     // Darker yellow
    accentColor: '263 80% 50%',        // Purple
    backgroundColor: '45 50% 97%',     // Soft yellow white
    textColor: '45 80% 15%',           // Yellow dark
    borderColor: '45 40% 85%',         // Soft yellow gray
    successColor: '120 70% 45%',       // Green
    warningColor: '40 100% 50%',       // Orange
    errorColor: '0 84% 60%',           // Red
  },
};

/**
 * Get a theme by ID
 */
export function getAdvancedTheme(id: AdvancedTheme): AdvancedThemeConfig {
  return ADVANCED_THEMES[id] || ADVANCED_THEMES['x-light'];
}

/**
 * Get all themes in a category
 */
export function getThemesByCategory(category: AdvancedThemeConfig['category']): AdvancedThemeConfig[] {
  return Object.values(ADVANCED_THEMES).filter(theme => theme.category === category);
}

/**
 * Apply theme to document
 */
/**
 * Whether a theme is meant to be read on a light or a dark ground.
 *
 * Taken from its own background rather than from its name: "sunset" and
 * "bitcoin-gold" say nothing about lightness, and a theme applied in the wrong
 * mode is unreadable rather than merely wrong.
 */
export function advancedThemeMode(
  theme: AdvancedThemeConfig
): 'light' | 'dark' {
  // `H S% L%` — the third component is the one that decides
  const lightness = Number.parseFloat(
    theme.backgroundColor.trim().split(/\s+/)[2] ?? '100'
  );

  return Number.isFinite(lightness) && lightness < 50 ? 'dark' : 'light';
}

/**
 * An advanced theme in the shape the real theming pipeline understands.
 *
 * This is the whole fix. These themes used to write `--theme-primary` and
 * friends, which nothing in the stylesheet reads, and stamp a
 * `data-advanced-theme` attribute no rule matches — so picking one changed
 * nothing, and did not survive a reload either, because it was applied on
 * click and never on load.
 *
 * Both modes are filled with the theme's own colours. A theme is a complete
 * look, not a hue to be re-derived for the mode someone happens to be in, and
 * selecting one sets the mode to match.
 */
export function advancedThemeToPreset(theme: AdvancedThemeConfig): {
  id: string;
  name: string;
  light: { background: string; foreground: string; primary: string };
  dark: { background: string; foreground: string; primary: string };
} {
  const cores = {
    background: theme.backgroundColor,
    foreground: theme.textColor,
    // The accent, not `primaryColor`: these themes use "primary" for their
    // text colour, so it is the accent that carries the identity
    primary: theme.accentColor,
  };

  return { id: theme.id, name: theme.name, light: cores, dark: cores };
}

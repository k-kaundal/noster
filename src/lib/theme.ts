/**
 * Professional theme configuration system for NostrFeed
 * Provides multiple theme options with consistent design language
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePreset = 'default' | 'professional' | 'minimal' | 'dark-mode';

export interface ThemeConfig {
  name: string;
  preset: ThemePreset;
  primaryColor: string;
  accentColor: string;
  description: string;
}

/**
 * Available theme presets for professional branding
 */
export const THEME_PRESETS: Record<ThemePreset, ThemeConfig> = {
  default: {
    name: 'Default',
    preset: 'default',
    primaryColor: '262.1 83.3% 57.8%',
    accentColor: '220 14.3% 95.9%',
    description: 'Clean and balanced design',
  },
  professional: {
    name: 'Professional',
    preset: 'professional',
    primaryColor: '217 91% 60%',
    accentColor: '220 8.9% 46.1%',
    description: 'Modern corporate aesthetic',
  },
  minimal: {
    name: 'Minimal',
    preset: 'minimal',
    primaryColor: '240 10% 3.9%',
    accentColor: '220 14.3% 95.9%',
    description: 'Distraction-free interface',
  },
  'dark-mode': {
    name: 'Dark Mode',
    preset: 'dark-mode',
    primaryColor: '263.4 70% 60%',
    accentColor: '240 8% 7%',
    description: 'Eye-friendly dark theme',
  },
};

/**
 * Typography scale for professional hierarchy
 */
export const TYPOGRAPHY = {
  h1: 'text-4xl font-bold tracking-tight',
  h2: 'text-3xl font-bold tracking-tight',
  h3: 'text-2xl font-semibold',
  h4: 'text-xl font-semibold',
  body: 'text-base leading-relaxed',
  bodySmall: 'text-sm leading-relaxed',
  caption: 'text-xs uppercase tracking-wide',
  mono: 'font-mono text-sm',
} as const;

/**
 * Professional spacing scale
 */
export const SPACING = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
  '3xl': '4rem',
} as const;

/**
 * Shadow system for depth
 */
export const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  float: '0 0 0 1px rgb(0 0 0 / 0.05), 0 4px 12px rgb(0 0 0 / 0.08)',
} as const;

/**
 * Border radius system
 */
export const BORDER_RADIUS = {
  none: '0',
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  '2xl': '1.5rem',
  full: '9999px',
} as const;

/**
 * Transition/animation configuration
 */
export const TRANSITIONS = {
  fast: 'duration-150',
  normal: 'duration-200',
  slow: 'duration-300',
} as const;

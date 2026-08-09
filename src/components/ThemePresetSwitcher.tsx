import { useCallback } from 'react';
import { THEME_PRESETS, type ThemePreset } from '@/lib/theme';
import { Button } from '@/components/ui/button';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { cn } from '@/lib/utils';

/**
 * Theme preset switcher for professional branding options.
 * Allows users to switch between predefined theme configurations.
 */
export function ThemePresetSwitcher() {
  const [currentPreset, setCurrentPreset] = useLocalStorage<ThemePreset>(
    'theme:preset',
    'default'
  );

  const handlePresetChange = useCallback(
    (preset: ThemePreset) => {
      setCurrentPreset(preset);
      // Apply theme-specific CSS variables if needed
      applyThemePreset(preset);
    },
    [setCurrentPreset]
  );

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Theme Preset
      </p>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(THEME_PRESETS).map(([key, config]) => (
          <Button
            key={key}
            variant={currentPreset === key ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePresetChange(key as ThemePreset)}
            className={cn(
              'h-auto flex-col gap-1 px-3 py-2 text-left',
              currentPreset === key && 'ring-2'
            )}
          >
            <span className="text-xs font-semibold">{config.name}</span>
            <span className="text-[10px] text-muted-foreground line-clamp-1">
              {config.description}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Apply theme preset by setting CSS variables.
 * This function can be extended to apply more theme-specific styles.
 */
function applyThemePreset(preset: ThemePreset) {
  const config = THEME_PRESETS[preset];
  const root = document.documentElement;

  // Apply primary and accent colors as CSS variables
  root.style.setProperty('--primary-color', config.primaryColor);
  root.style.setProperty('--accent-color', config.accentColor);

  // Add data attribute for CSS-based theme selection
  root.setAttribute('data-theme-preset', preset);
}

// Initialize theme on page load
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('theme:preset') as ThemePreset;
  if (stored) {
    applyThemePreset(stored);
  }
}

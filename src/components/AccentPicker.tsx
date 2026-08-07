import { Check, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppContext } from '@/hooks/useAppContext';
import { useTheme } from '@/hooks/useTheme';
import { ACCENT_PRESETS, deriveTokens, getAccentPreset } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * Palette switcher. Each swatch previews the palette against the mode the user
 * is actually in, rather than a fixed light preview that would misrepresent
 * how it looks in dark mode.
 */
export function AccentPicker({ className }: { className?: string }) {
  const { config, updateConfig } = useAppContext();
  const { theme } = useTheme();

  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'system' ? prefersDark : theme === 'dark';

  const active = getAccentPreset(config.accent);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Accent colour: ${active.name}`}
          className={className}
        >
          <Palette className="h-[1.2rem] w-[1.2rem]" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Accent colour</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <div className="grid grid-cols-3 gap-2 p-2">
          {ACCENT_PRESETS.map((preset) => {
            const tokens = deriveTokens(isDark ? preset.dark : preset.light);
            const isActive = preset.id === config.accent;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  updateConfig((current) => ({ ...current, accent: preset.id }))
                }
                aria-pressed={isActive}
                className={cn(
                  'group flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors',
                  isActive
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/40 hover:bg-accent/50'
                )}
              >
                <span
                  className="relative flex h-8 w-full items-center justify-center rounded-md border"
                  style={{
                    backgroundColor: `hsl(${tokens.card})`,
                    borderColor: `hsl(${tokens.border})`,
                  }}
                >
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{
                      backgroundImage: `linear-gradient(135deg, hsl(${tokens['brand-from']}), hsl(${tokens['brand-to']}))`,
                    }}
                  />
                  {isActive && (
                    <Check
                      className="absolute right-1 top-1 h-3 w-3"
                      style={{ color: `hsl(${tokens.primary})` }}
                    />
                  )}
                </span>
                <span className="text-[11px] font-medium">{preset.name}</span>
              </button>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

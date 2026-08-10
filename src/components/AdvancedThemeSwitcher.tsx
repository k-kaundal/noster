import {
  advancedThemeMode,
  getThemesByCategory,
  type AdvancedTheme,
  type AdvancedThemeConfig,
} from '@/lib/advanced-themes';
import { useAppContext } from '@/hooks/useAppContext';
import { deriveTokens } from '@/lib/theme';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

/**
 * Full themes, as opposed to the accent picker's hues.
 *
 * These used to be a second theming system that did nothing: it wrote
 * `--theme-primary` and friends, which no rule in the stylesheet reads, kept
 * its choice in its own storage key, and re-applied on click but never on
 * load. Selecting one appeared to work and changed nothing, and the selection
 * was gone by the next reload.
 *
 * They are ordinary palettes now, stored in app config beside the accent and
 * applied by the same effect. Choosing one also sets light or dark to match,
 * because a theme is a complete look and half of these are only legible in the
 * mode they were designed for.
 */
export function AdvancedThemeSwitcher() {
  const { config, updateConfig } = useAppContext();
  const currentTheme = config.accent;

  const handleThemeChange = (theme: AdvancedTheme, mode: 'light' | 'dark') => {
    updateConfig((current) => ({ ...current, accent: theme, theme: mode }));
  };

  const categories = ['inspired', 'premium', 'corporate', 'minimal', 'creative', 'crypto'] as const;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Full themes</h3>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          Each one sets the whole palette and switches light or dark to match.
          Picking an accent colour above replaces it.
        </p>
      </div>

      <Tabs defaultValue="inspired" className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 h-auto">
          <TabsTrigger value="inspired" className="text-xs py-1">
            Inspired
          </TabsTrigger>
          <TabsTrigger value="premium" className="text-xs py-1">
            Premium
          </TabsTrigger>
          <TabsTrigger value="corporate" className="text-xs py-1">
            Corporate
          </TabsTrigger>
          <TabsTrigger value="minimal" className="text-xs py-1">
            Minimal
          </TabsTrigger>
          <TabsTrigger value="creative" className="text-xs py-1">
            Creative
          </TabsTrigger>
          <TabsTrigger value="crypto" className="text-xs py-1">
            Crypto
          </TabsTrigger>
        </TabsList>

        {categories.map((category) => (
          <TabsContent key={category} value={category} className="mt-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {getThemesByCategory(category).map((theme) => (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  isActive={currentTheme === theme.id}
                  onClick={() =>
                    handleThemeChange(
                      theme.id as AdvancedTheme,
                      advancedThemeMode(theme)
                    )
                  }
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

interface ThemeCardProps {
  theme: AdvancedThemeConfig;
  isActive: boolean;
  onClick: () => void;
}

function ThemeCard({ theme, isActive, onClick }: ThemeCardProps) {
  const preview = deriveTokens({
    background: theme.backgroundColor,
    foreground: theme.textColor,
    primary: theme.accentColor,
  });

  return (
    <Button
      variant={isActive ? 'default' : 'outline'}
      onClick={onClick}
      className={cn(
        'h-auto flex-col gap-2 p-3 text-left transition-all',
        isActive && 'ring-2 ring-primary'
      )}
    >
      {/*
        A preview of the theme as it will actually render, built from the same
        derivation the app uses. Two raw swatches said nothing about what
        picking this would do to the page.
      */}
      <div
        className="flex w-full items-center gap-1.5 rounded-md border p-1.5"
        style={{
          backgroundColor: `hsl(${preview.card})`,
          borderColor: `hsl(${preview.border})`,
        }}
      >
        <span
          className="h-4 w-4 shrink-0 rounded-full"
          style={{
            backgroundImage: `linear-gradient(135deg, hsl(${preview['brand-from']}), hsl(${preview['brand-to']}))`,
          }}
        />
        <span className="flex-1 space-y-1">
          <span
            className="block h-1.5 w-full rounded-full"
            style={{ backgroundColor: `hsl(${preview.foreground})`, opacity: 0.8 }}
          />
          <span
            className="block h-1.5 w-2/3 rounded-full"
            style={{ backgroundColor: `hsl(${preview['muted-foreground']})` }}
          />
        </span>
      </div>

      {/* Theme name and description */}
      <div className="w-full">
        <div className="text-xs font-semibold truncate">{theme.name}</div>
        <div className="text-[10px] text-muted-foreground line-clamp-1">
          {theme.description}
        </div>
      </div>

      {/* Active indicator */}
      {isActive && (
        <div className="text-[10px] font-medium text-primary">✓ Active</div>
      )}
    </Button>
  );
}

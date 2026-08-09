import { useEffect, useState } from 'react';
import {
  ADVANCED_THEMES,
  applyAdvancedTheme,
  getCurrentAdvancedTheme,
  getThemesByCategory,
  type AdvancedTheme,
  type AdvancedThemeConfig,
} from '@/lib/advanced-themes';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

/**
 * Advanced theme switcher with categorized selection
 */
export function AdvancedThemeSwitcher() {
  const [currentTheme, setCurrentTheme] = useState<AdvancedTheme>('x-light');

  useEffect(() => {
    const theme = getCurrentAdvancedTheme();
    setCurrentTheme(theme);
  }, []);

  const handleThemeChange = (theme: AdvancedTheme) => {
    setCurrentTheme(theme);
    const themeConfig = ADVANCED_THEMES[theme];
    applyAdvancedTheme(themeConfig);
  };

  const categories = ['inspired', 'premium', 'corporate', 'minimal', 'creative', 'crypto'] as const;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Theme</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Choose from professional and creative themes
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
                  onClick={() => handleThemeChange(theme.id as AdvancedTheme)}
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
  return (
    <Button
      variant={isActive ? 'default' : 'outline'}
      onClick={onClick}
      className={cn(
        'h-auto flex-col gap-2 p-3 text-left transition-all',
        isActive && 'ring-2 ring-primary'
      )}
    >
      {/* Color preview bars */}
      <div className="w-full space-y-1">
        <div className="h-2 rounded-sm flex gap-1">
          <div
            className="flex-1 rounded-sm"
            style={{ backgroundColor: `hsl(${theme.primaryColor})` }}
          />
          <div
            className="flex-1 rounded-sm"
            style={{ backgroundColor: `hsl(${theme.accentColor})` }}
          />
        </div>
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

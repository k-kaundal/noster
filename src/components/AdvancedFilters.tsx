import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAdvancedFilters, type ContentType } from '@/hooks/useAdvancedFilters';

export function AdvancedFiltersButton() {
  const { filters, updateFilter, resetFilters, toggleEnabled } = useAdvancedFilters();

  const contentTypeOptions: { value: ContentType; label: string }[] = [
    { value: 'all', label: 'All content' },
    { value: 'text', label: 'Text only' },
    { value: 'image', label: 'With images' },
    { value: 'video', label: 'With videos' },
    { value: 'article', label: 'Articles' },
  ];

  const isFilterActive = filters.enabled && (
    filters.minQualityScore > 0 ||
    filters.hideReplies ||
    filters.hideReposts ||
    filters.hideSpam ||
    filters.minEngagement > 0 ||
    filters.minAccountAge > 0 ||
    (filters.contentTypes.length === 1 && filters.contentTypes[0] !== 'all')
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          title="Advanced filters"
        >
          <Filter className={`h-4 w-4 ${isFilterActive ? 'text-primary' : ''}`} />
          <span className="hidden sm:inline text-xs">Filters</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0">
        <Card className="border-0 shadow-none">
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Advanced Filters</CardTitle>
                <CardDescription>Customize your feed</CardDescription>
              </div>
              {isFilterActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="h-7 w-7 p-0"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Master toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="enable-filters" className="cursor-pointer">
                Enable filters
              </Label>
              <Switch
                id="enable-filters"
                checked={filters.enabled}
                onCheckedChange={toggleEnabled}
              />
            </div>

            {filters.enabled && (
              <>
                {/* Quality Score */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Minimum quality score</Label>
                    <span className="text-sm text-muted-foreground">
                      {filters.minQualityScore}
                    </span>
                  </div>
                  <Slider
                    value={[filters.minQualityScore]}
                    onValueChange={(value) =>
                      updateFilter('minQualityScore', value[0])
                    }
                    min={0}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Hide posts below this quality threshold
                  </p>
                </div>

                {/* Post Types */}
                <div className="space-y-3">
                  <Label>Post type</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {contentTypeOptions.map((option) => (
                      <Button
                        key={option.value}
                        variant={
                          filters.contentTypes.includes(option.value)
                            ? 'default'
                            : 'outline'
                        }
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          if (option.value === 'all') {
                            updateFilter('contentTypes', ['all']);
                          } else {
                            const newTypes = filters.contentTypes.includes(
                              option.value
                            )
                              ? filters.contentTypes.filter((t) => t !== option.value)
                              : [option.value];
                            updateFilter('contentTypes', newTypes.length > 0 ? newTypes : ['all']);
                          }
                        }}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Hide Replies/Reposts */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="hide-replies" className="cursor-pointer">
                      Hide replies
                    </Label>
                    <Switch
                      id="hide-replies"
                      checked={filters.hideReplies}
                      onCheckedChange={(checked) =>
                        updateFilter('hideReplies', checked)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="hide-reposts" className="cursor-pointer">
                      Hide reposts
                    </Label>
                    <Switch
                      id="hide-reposts"
                      checked={filters.hideReposts}
                      onCheckedChange={(checked) =>
                        updateFilter('hideReposts', checked)
                      }
                    />
                  </div>
                </div>

                {/* Spam Filter */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="hide-spam" className="cursor-pointer">
                      Hide likely spam
                    </Label>
                    <Switch
                      id="hide-spam"
                      checked={filters.hideSpam}
                      onCheckedChange={(checked) =>
                        updateFilter('hideSpam', checked)
                      }
                    />
                  </div>

                  {filters.hideSpam && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Spam confidence threshold
                        </span>
                        <span>{filters.spamConfidenceThreshold}%</span>
                      </div>
                      <Slider
                        value={[filters.spamConfidenceThreshold]}
                        onValueChange={(value) =>
                          updateFilter('spamConfidenceThreshold', value[0])
                        }
                        min={0}
                        max={100}
                        step={5}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>

                {/* Engagement Threshold */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Minimum engagement</Label>
                    <span className="text-sm text-muted-foreground">
                      {filters.minEngagement}
                    </span>
                  </div>
                  <Slider
                    value={[filters.minEngagement]}
                    onValueChange={(value) =>
                      updateFilter('minEngagement', value[0])
                    }
                    min={0}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum replies + reposts + reactions combined
                  </p>
                </div>

                {/* Account Age */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Minimum account age</Label>
                    <span className="text-sm text-muted-foreground">
                      {filters.minAccountAge} days
                    </span>
                  </div>
                  <Slider
                    value={[filters.minAccountAge]}
                    onValueChange={(value) =>
                      updateFilter('minAccountAge', value[0])
                    }
                    min={0}
                    max={365}
                    step={7}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Hide posts from very new accounts
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </PopoverContent>
    </Popover>
  );
}

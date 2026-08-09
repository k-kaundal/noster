import { useLocalStorage } from './useLocalStorage';

export type ContentType = 'all' | 'text' | 'image' | 'video' | 'article';

export interface AdvancedFilters {
  // Quality filtering
  minQualityScore: number; // 0-100
  hideReplies: boolean;
  hideReposts: boolean;

  // Spam filtering
  hideSpam: boolean;
  spamConfidenceThreshold: number; // 0-100

  // Content filtering
  contentTypes: ContentType[];
  minEngagement: number; // Minimum replies+reposts+reactions
  minAccountAge: number; // In days

  // Enabled state
  enabled: boolean;
}

const DEFAULT_FILTERS: AdvancedFilters = {
  minQualityScore: 0,
  hideReplies: false,
  hideReposts: false,
  hideSpam: true,
  spamConfidenceThreshold: 40,
  contentTypes: ['all'],
  minEngagement: 0,
  minAccountAge: 0,
  enabled: false,
};

/**
 * Hook for managing advanced filter state with localStorage persistence
 */
export function useAdvancedFilters() {
  const [filters, setFilters] = useLocalStorage<AdvancedFilters>(
    'advanced-filters',
    DEFAULT_FILTERS
  );

  const updateFilter = <K extends keyof AdvancedFilters>(
    key: K,
    value: AdvancedFilters[K]
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  const toggleEnabled = () => {
    setFilters((prev) => ({ ...prev, enabled: !prev.enabled }));
  };

  return {
    filters,
    updateFilter,
    resetFilters,
    toggleEnabled,
  };
}

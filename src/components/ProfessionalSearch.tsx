/**
 * Professional search component with advanced filtering
 * Supports content search, user search, and hashtag discovery
 */

import { useState, useEffect } from 'react';
import { Search, X, TrendingUp, Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  type: 'post' | 'user' | 'hashtag';
  title: string;
  description?: string;
  meta?: string;
}

interface ProfessionalSearchProps {
  onSearch?: (query: string) => void;
  onResultSelect?: (result: SearchResult) => void;
  className?: string;
}

/**
 * Professional search interface with autocomplete and suggestions
 */
export function ProfessionalSearch({
  onSearch,
  onResultSelect,
  className,
}: ProfessionalSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('recent-searches');
    if (stored) {
      setRecentSearches(JSON.parse(stored).slice(0, 5));
    }
  }, []);

  const handleSearch = async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      // Simulate search - replace with actual API call
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Mock results
      setResults([
        {
          id: '1',
          type: 'hashtag',
          title: '#' + q,
          description: 'Explore posts tagged with ' + q,
          meta: '1.2K posts',
        },
        {
          id: '2',
          type: 'post',
          title: 'Post containing "' + q + '"',
          description: 'Recent posts matching your search',
          meta: '42 results',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setIsOpen(true);
    if (value.length > 0) {
      handleSearch(value);
    } else {
      setResults([]);
    }
  };

  const handleResultClick = (result: SearchResult) => {
    onResultSelect?.(result);

    // Save to recent
    const updated = [
      result.title,
      ...recentSearches.filter((s) => s !== result.title),
    ].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem('recent-searches', JSON.stringify(updated));

    setIsOpen(false);
    setQuery('');
  };

  const handleRecentClick = (search: string) => {
    setQuery(search);
    handleSearch(search);
  };

  return (
    <div className={cn('relative w-full', className)}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search posts, people, hashtags..."
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          className="pl-10 pr-10 h-11 rounded-full bg-background/50 border-primary/20 focus:border-primary focus:bg-background transition-all"
          aria-label="Search"
        />
        {query && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('');
              setResults([]);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <Card className="absolute top-full mt-2 w-full rounded-xl shadow-lg border-0 z-50 max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          ) : results.length > 0 ? (
            <div className="divide-y">
              {results.map((result) => (
                <button
                  key={result.id}
                  onClick={() => handleResultClick(result)}
                  className="w-full text-left p-4 hover:bg-background/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{result.title}</div>
                      {result.description && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {result.description}
                        </p>
                      )}
                    </div>
                    {result.meta && (
                      <Badge variant="secondary" className="shrink-0">
                        {result.meta}
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : query.length === 0 ? (
            <div className="p-4">
              {recentSearches.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-3">
                    <Clock className="h-3 w-3" />
                    RECENT SEARCHES
                  </div>
                  <div className="space-y-2">
                    {recentSearches.map((search) => (
                      <button
                        key={search}
                        onClick={() => handleRecentClick(search)}
                        className="w-full text-left text-sm p-2 hover:bg-background/50 rounded-lg transition-colors"
                      >
                        {search}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-border/30">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-3">
                  <TrendingUp className="h-3 w-3" />
                  TRENDING
                </div>
                <div className="space-y-2">
                  {['#nostr', '#bitcoin', '#lightning'].map((tag) => (
                    <button
                      key={tag}
                      onClick={() => handleRecentClick(tag)}
                      className="w-full text-left text-sm p-2 hover:bg-background/50 rounded-lg transition-colors"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No results found for "{query}"
            </div>
          )}
        </Card>
      )}

      {/* Overlay to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

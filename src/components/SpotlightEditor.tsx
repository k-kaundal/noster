import { useState, useCallback, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  ChevronDown,
  Loader2,
  X,
  Trash2,
  GripVertical,
  Plus,
} from 'lucide-react';
import type { SpotlightItem } from '@/hooks/useSpotlight';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface SpotlightEditorProps {
  items: SpotlightItem[];
  onAddItem: (item: SpotlightItem) => void;
  onRemoveItem: (id: string) => void;
  isPublishing: boolean;
  onSave: () => void;
  onCancel: () => void;
}

type ItemType = 'post' | 'article' | 'community' | 'user';

interface SelectableItem {
  id: string;
  title: string;
  subtitle?: string;
  type: ItemType;
  image?: string;
}

/**
 * Editor for spotlight with smart dropdown selection
 * Fetches user's own posts, communities (owner/moderator), following list
 */
export function SpotlightEditor({
  items,
  onAddItem,
  onRemoveItem,
  isPublishing,
  onSave,
  onCancel,
}: SpotlightEditorProps) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { followingList } = useFollows(user?.pubkey || '');

  const [selectedType, setSelectedType] = useState<ItemType>('post');
  const [selectedItem, setSelectedItem] = useState<string>('');

  // Fetch user's posts
  const { data: userPosts, isLoading: postsLoading } = useQuery({
    queryKey: ['user-posts', user?.pubkey],
    queryFn: async () => {
      if (!user?.pubkey) return [];
      const signal = AbortSignal.any([AbortSignal.timeout(3000)]);
      const events = await nostr.query(
        [{ kinds: [1], authors: [user.pubkey], limit: 50 }],
        { signal }
      );
      return events.sort((a, b) => b.created_at - a.created_at).slice(0, 20);
    },
    enabled: !!user?.pubkey && selectedType === 'post',
  });

  // Fetch user's articles
  const { data: userArticles, isLoading: articlesLoading } = useQuery({
    queryKey: ['user-articles', user?.pubkey],
    queryFn: async () => {
      if (!user?.pubkey) return [];
      const signal = AbortSignal.any([AbortSignal.timeout(3000)]);
      const events = await nostr.query(
        [{ kinds: [23], authors: [user.pubkey], limit: 50 }],
        { signal }
      );
      return events.sort((a, b) => b.created_at - a.created_at).slice(0, 20);
    },
    enabled: !!user?.pubkey && selectedType === 'article',
  });

  // Fetch user's communities (owner/moderator)
  const { data: userCommunities, isLoading: communitiesLoading } = useQuery({
    queryKey: ['user-communities', user?.pubkey],
    queryFn: async () => {
      if (!user?.pubkey) return [];
      const signal = AbortSignal.any([AbortSignal.timeout(3000)]);
      const events = await nostr.query(
        [{ kinds: [34550], authors: [user.pubkey], limit: 50 }],
        { signal }
      );
      return events.sort((a, b) => b.created_at - a.created_at).slice(0, 20);
    },
    enabled: !!user?.pubkey && selectedType === 'community',
  });

  // Build selectible items based on type
  const selectableItems = useMemo<SelectableItem[]>(() => {
    switch (selectedType) {
      case 'post':
        return (userPosts || []).map(event => ({
          id: event.id,
          title: event.content.substring(0, 60) || '(empty post)',
          subtitle: new Date(event.created_at * 1000).toLocaleDateString(),
          type: 'post' as const,
        }));

      case 'article':
        return (userArticles || []).map(event => {
          const title = event.tags.find(([t]) => t === 'title')?.[1] || 'Untitled';
          return {
            id: event.id,
            title,
            subtitle: new Date(event.created_at * 1000).toLocaleDateString(),
            type: 'article' as const,
          };
        });

      case 'community':
        return (userCommunities || []).map(event => {
          const slug = event.tags.find(([t]) => t === 'd')?.[1] || '';
          const name = event.tags.find(([t]) => t === 'name')?.[1] || slug;
          const image = event.tags.find(([t]) => t === 'image')?.[1];
          return {
            id: nip19.naddrEncode({ pubkey: event.pubkey, kind: 34550, identifier: slug }),
            title: name,
            subtitle: slug,
            type: 'community' as const,
            image,
          };
        });

      case 'user':
        return followingList.slice(0, 30).map(follow => ({
          id: follow.pubkey,
          title: genUserName(follow.pubkey),
          subtitle: 'Following',
          type: 'user' as const,
        }));

      default:
        return [];
    }
  }, [selectedType, userPosts, userArticles, userCommunities, followingList]);

  const isLoading = {
    post: postsLoading,
    article: articlesLoading,
    community: communitiesLoading,
    user: false,
  }[selectedType];

  const handleAddSelectedItem = useCallback(() => {
    if (!selectedItem) return;

    const item = selectableItems.find(i => i.id === selectedItem);
    if (!item) return;

    onAddItem({
      id: item.id,
      type: selectedType,
      title: item.title,
      description: item.subtitle,
      order: items.length,
    });

    setSelectedItem('');
  }, [selectedItem, selectableItems, selectedType, items.length, onAddItem]);

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
      {/* Current Items */}
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Featured Items ({items.length})</h3>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items added yet</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <SpotlightItemRow
                key={item.id}
                item={item}
                onRemove={() => onRemoveItem(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add New Item */}
      <div className="space-y-3 pt-4 border-t">
        <h3 className="font-semibold text-sm">Add Item</h3>

        {/* Type Selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium">Type</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['post', 'article', 'community', 'user'] as const).map((type) => (
              <Button
                key={type}
                size="sm"
                variant={selectedType === type ? 'default' : 'outline'}
                onClick={() => {
                  setSelectedType(type);
                  setSelectedItem('');
                }}
                className="capitalize text-xs"
              >
                {type}
              </Button>
            ))}
          </div>
        </div>

        {/* Item Selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium capitalize">
            Choose {selectedType}
          </label>
          <Select value={selectedItem} onValueChange={setSelectedItem}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={`Select ${selectedType}...`} />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {isLoading ? (
                <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin mr-2" />
                  Loading...
                </div>
              ) : selectableItems.length === 0 ? (
                <div className="py-4 px-2 text-xs text-muted-foreground text-center">
                  No {selectedType}s found
                </div>
              ) : (
                selectableItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    <div className="flex items-center gap-2">
                      {item.image && selectedType === 'user' && (
                        <img
                          src={item.image}
                          alt=""
                          className="h-4 w-4 rounded-full"
                        />
                      )}
                      <div>
                        <div className="text-sm font-medium">
                          {item.title.substring(0, 40)}
                        </div>
                        {item.subtitle && (
                          <div className="text-xs text-muted-foreground">
                            {item.subtitle.substring(0, 30)}
                          </div>
                        )}
                      </div>
                    </div>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          onClick={handleAddSelectedItem}
          disabled={!selectedItem || isLoading}
          className="w-full gap-2"
        >
          <Plus className="h-4 w-4" />
          Add {selectedType.charAt(0).toUpperCase() + selectedType.slice(1)}
        </Button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t">
        <Button
          onClick={onSave}
          disabled={isPublishing || items.length === 0}
          className="flex-1"
        >
          {isPublishing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            'Save Spotlight'
          )}
        </Button>
        <Button
          onClick={onCancel}
          variant="outline"
          disabled={isPublishing}
          className="flex-1"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface SpotlightItemRowProps {
  item: SpotlightItem;
  onRemove: () => void;
}

function SpotlightItemRow({ item, onRemove }: SpotlightItemRowProps) {
  return (
    <div className="flex items-center justify-between bg-background rounded-md p-3 border">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{item.title || item.id}</p>
          <p className="text-xs text-muted-foreground capitalize">{item.type}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRemove}
        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/20 shrink-0"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

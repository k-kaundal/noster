import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Star,
  Trash2,
  GripVertical,
  Plus,
  X,
  Loader2,
} from 'lucide-react';
import { useSpotlight, usePublishSpotlight, type SpotlightItem } from '@/hooks/useSpotlight';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';

interface SpotlightProps {
  pubkey: string;
  events?: Map<string, NostrEvent>;
}

/**
 * Spotlight section showing featured posts, articles, communities, and users
 */
export function Spotlight({ pubkey, events }: SpotlightProps) {
  const { data: spotlight, isLoading } = useSpotlight(pubkey);
  const { user } = useCurrentUser();
  const [isEditing, setIsEditing] = useState(false);
  const [editItems, setEditItems] = useState<SpotlightItem[]>([]);
  const { publishSpotlight } = usePublishSpotlight();
  const { toast } = useToast();
  const [isPublishing, setIsPublishing] = useState(false);
  const isOwnProfile = user?.pubkey === pubkey;

  if (!spotlight?.items?.length && !isOwnProfile) {
    return null;
  }

  const handleStartEditing = useCallback(() => {
    setEditItems(spotlight?.items ?? []);
    setIsEditing(true);
  }, [spotlight]);

  const handleRemoveItem = useCallback((id: string) => {
    setEditItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const handleAddItem = useCallback((item: SpotlightItem) => {
    setEditItems(prev => {
      const exists = prev.find(i => i.id === item.id);
      if (exists) return prev;
      return [...prev, { ...item, order: prev.length }];
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!user) return;

    try {
      setIsPublishing(true);
      const itemsWithOrder = editItems.map((item, index) => ({
        ...item,
        order: index,
      }));
      await publishSpotlight(itemsWithOrder);
      setIsEditing(false);
      toast({
        title: 'Success',
        description: 'Spotlight updated',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update spotlight',
        variant: 'destructive',
      });
    } finally {
      setIsPublishing(false);
    }
  }, [user, editItems, publishSpotlight, toast]);

  return (
    <div className="space-y-4">
      {isOwnProfile && (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" />
            Spotlight
          </h2>
          {!isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartEditing}
            >
              {spotlight?.items?.length ? 'Edit' : 'Add'}
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : isEditing && isOwnProfile ? (
        <SpotlightEditor
          items={editItems}
          onRemoveItem={handleRemoveItem}
          onAddItem={handleAddItem}
          onSave={handleSave}
          onCancel={() => setIsEditing(false)}
          isPublishing={isPublishing}
        />
      ) : spotlight?.items?.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {spotlight.items.map((item) => (
            <SpotlightItemCard
              key={item.id}
              item={item}
              event={events?.get(item.id)}
            />
          ))}
        </div>
      ) : isOwnProfile ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <Star className="h-8 w-8 text-muted-foreground mb-2 opacity-50" />
            <p className="text-sm text-muted-foreground mb-4">
              No spotlight items yet
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleStartEditing}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add featured items
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

interface SpotlightEditorProps {
  items: SpotlightItem[];
  onRemoveItem: (id: string) => void;
  onAddItem: (item: SpotlightItem) => void;
  onSave: () => void;
  onCancel: () => void;
  isPublishing: boolean;
}

function SpotlightEditor({
  items,
  onRemoveItem,
  onAddItem,
  onSave,
  onCancel,
  isPublishing,
}: SpotlightEditorProps) {
  const [newItemType, setNewItemType] = useState<'post' | 'article' | 'community' | 'user'>('post');
  const [newItemId, setNewItemId] = useState('');
  const [newItemTitle, setNewItemTitle] = useState('');

  const handleAddNewItem = useCallback(() => {
    if (!newItemId.trim()) return;

    onAddItem({
      id: newItemId.trim(),
      type: newItemType,
      title: newItemTitle.trim() || undefined,
      description: undefined,
      order: items.length,
    });

    setNewItemId('');
    setNewItemTitle('');
  }, [newItemType, newItemId, newItemTitle, onAddItem, items.length]);

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
              <div
                key={item.id}
                className="flex items-center justify-between bg-background rounded-md p-3 border"
              >
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
                  onClick={() => onRemoveItem(item.id)}
                  className="h-7 w-7 p-0 text-destructive hover:bg-destructive/20 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add New Item */}
      <div className="space-y-3 pt-4 border-t">
        <h3 className="font-semibold text-sm">Add Item</h3>

        <div className="space-y-2">
          <label className="text-xs font-medium">Type</label>
          <div className="grid grid-cols-2 gap-2">
            {(['post', 'article', 'community', 'user'] as const).map((type) => (
              <Button
                key={type}
                size="sm"
                variant={newItemType === type ? 'default' : 'outline'}
                onClick={() => setNewItemType(type)}
                className="capitalize text-xs"
              >
                {type}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium">ID (event/pubkey/address)</label>
          <Input
            placeholder={`Paste ${newItemType} ID or pubkey...`}
            value={newItemId}
            onChange={(e) => setNewItemId(e.target.value)}
            className="text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium">Title (optional)</label>
          <Input
            placeholder="Custom title..."
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.target.value)}
            className="text-sm"
          />
        </div>

        <Button
          size="sm"
          onClick={handleAddNewItem}
          disabled={!newItemId.trim()}
          className="w-full gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </Button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t">
        <Button
          size="sm"
          onClick={onSave}
          disabled={isPublishing || items.length === 0}
          className="flex-1"
        >
          {isPublishing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Spotlight'
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={isPublishing}
          className="flex-1"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}


interface SpotlightItemCardProps {
  item: SpotlightItem;
  event?: NostrEvent;
}

function SpotlightItemCard({ item, event }: SpotlightItemCardProps) {
  const author = useAuthor(item.id.length === 64 ? item.id : '');
  const metadata = author.data?.metadata;

  const displayName = useMemo(() => {
    if (item.title) return item.title;
    if (item.type === 'user' && metadata?.display_name)
      return metadata.display_name;
    if (item.type === 'user' && metadata?.name) return metadata.name;
    if (item.type === 'user') return genUserName(item.id);
    if (event?.content) return event.content.substring(0, 50);
    return item.type.charAt(0).toUpperCase() + item.type.slice(1);
  }, [item, event, metadata]);

  const href = useMemo(() => {
    if (item.type === 'user') return `/${nip19.npubEncode(item.id)}`;
    if (item.type === 'post') return `/${nip19.noteEncode(item.id)}`;
    if (item.type === 'article') return `/${nip19.naddrEncode({ pubkey: item.id.substring(0, 64), kind: 30023, identifier: 'article' })}`;
    return '#';
  }, [item]);

  const icon = useMemo(() => {
    switch (item.type) {
      case 'post':
        return '💬';
      case 'article':
        return '📝';
      case 'community':
        return '👥';
      case 'user':
        return '👤';
      default:
        return '⭐';
    }
  }, [item.type]);

  return (
    <Link to={href}>
      <Card className="overflow-hidden hover:border-primary/50 transition-colors h-full">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            {item.type === 'user' ? (
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={metadata?.picture} alt={displayName} />
                <AvatarFallback className="text-xs">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg">
                {icon}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold line-clamp-2">
                {displayName}
              </p>
              {item.description && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                  {item.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2 capitalize">
                {item.type}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

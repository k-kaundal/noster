import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Star,
  Plus,
} from 'lucide-react';
import { useSpotlight, usePublishSpotlight, type SpotlightItem } from '@/hooks/useSpotlight';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { SpotlightEditor } from '@/components/SpotlightEditor';

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

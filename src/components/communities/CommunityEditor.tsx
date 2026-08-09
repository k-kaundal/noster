import { useState, useCallback } from 'react';
import { Loader2, X, Plus, Shield } from 'lucide-react';
import type { Community } from '@/lib/community';
import { buildCommunityTags, type CommunityDraft } from '@/lib/community';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface CommunityEditorProps {
  community: Community;
  onClose: () => void;
  onSave?: () => void;
}

/**
 * Editor for community metadata (name, description, image, moderators, relays)
 * Only accessible to community moderators
 */
export function CommunityEditor({ community, onClose, onSave }: CommunityEditorProps) {
  const [draft, setDraft] = useState<CommunityDraft>({
    slug: community.slug,
    name: community.name,
    description: community.description,
    image: community.image,
    moderators: community.moderators.filter(m => m !== community.creator),
    relays: community.relays.map(r => r.url),
  });

  const [newModeratorInput, setNewModeratorInput] = useState('');
  const [newRelayInput, setNewRelayInput] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  const { mutate: publishEvent } = useNostrPublish();
  const { toast } = useToast();

  const handleAddModerator = useCallback(() => {
    const input = newModeratorInput.trim();
    if (!input) return;

    // Accept both npub and hex pubkey formats
    let pubkey = input;
    if (input.startsWith('npub1')) {
      try {
        const { data } = require('nostr-tools').nip19.decode(input) as { type: string; data: string };
        pubkey = data;
      } catch {
        toast({
          title: 'Invalid npub format',
          description: 'Please use a valid npub1... or hex pubkey',
          variant: 'destructive',
        });
        return;
      }
    }

    if (!/^[0-9a-f]{64}$/.test(pubkey.toLowerCase())) {
      toast({
        title: 'Invalid pubkey',
        description: 'Pubkey must be 64 hex characters',
        variant: 'destructive',
      });
      return;
    }

    if (draft.moderators.includes(pubkey.toLowerCase())) {
      toast({
        title: 'Already a moderator',
        description: 'This person is already a moderator',
        variant: 'destructive',
      });
      return;
    }

    setDraft(prev => ({
      ...prev,
      moderators: [...prev.moderators, pubkey.toLowerCase()],
    }));
    setNewModeratorInput('');
  }, [newModeratorInput, draft.moderators, toast]);

  const handleRemoveModerator = useCallback((pubkey: string) => {
    setDraft(prev => ({
      ...prev,
      moderators: prev.moderators.filter(m => m !== pubkey),
    }));
  }, []);

  const handleAddRelay = useCallback(() => {
    const url = newRelayInput.trim();
    if (!url) return;

    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      toast({
        title: 'Invalid relay URL',
        description: 'Relay must start with wss:// or ws://',
        variant: 'destructive',
      });
      return;
    }

    if (draft.relays.includes(url)) {
      toast({
        title: 'Relay already added',
        variant: 'destructive',
      });
      return;
    }

    setDraft(prev => ({
      ...prev,
      relays: [...prev.relays, url],
    }));
    setNewRelayInput('');
  }, [newRelayInput, draft.relays, toast]);

  const handleRemoveRelay = useCallback((url: string) => {
    setDraft(prev => ({
      ...prev,
      relays: prev.relays.filter(r => r !== url),
    }));
  }, []);

  const handlePublish = useCallback(async () => {
    try {
      setIsPublishing(true);
      const tags = buildCommunityTags(draft);

      await publishEvent({
        kind: 34550,
        content: '',
        tags,
      });

      toast({
        title: 'Success',
        description: 'Community updated',
      });

      onSave?.();
      onClose();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update community',
        variant: 'destructive',
      });
    } finally {
      setIsPublishing(false);
    }
  }, [draft, publishEvent, toast, onClose, onSave]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="sticky top-0 bg-background border-b flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Edit Community
          </CardTitle>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Community Name</Label>
            <Input
              id="name"
              value={draft.name}
              onChange={(e) => setDraft(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Community name"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description & Rules</Label>
            <Textarea
              id="description"
              value={draft.description}
              onChange={(e) => setDraft(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe your community and its rules..."
              className="min-h-24"
            />
          </div>

          {/* Image */}
          <div className="space-y-2">
            <Label htmlFor="image">Banner Image URL</Label>
            <Input
              id="image"
              value={draft.image || ''}
              onChange={(e) => setDraft(prev => ({ ...prev, image: e.target.value }))}
              placeholder="https://example.com/banner.png"
              type="url"
            />
            {draft.image && (
              <img
                src={draft.image}
                alt="Preview"
                className="h-32 w-full object-cover rounded-lg"
              />
            )}
          </div>

          {/* Moderators */}
          <div className="space-y-3">
            <Label>Moderators</Label>
            <div className="space-y-2">
              {[community.creator, ...draft.moderators].map((pubkey) => (
                <div
                  key={pubkey}
                  className="flex items-center justify-between bg-muted rounded-lg p-3"
                >
                  <code className="text-xs font-mono truncate">
                    {pubkey.slice(0, 16)}...
                  </code>
                  {pubkey === community.creator ? (
                    <span className="text-xs text-muted-foreground">Creator</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveModerator(pubkey)}
                      className="h-6 w-6 p-0 text-destructive hover:bg-destructive/20"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                value={newModeratorInput}
                onChange={(e) => setNewModeratorInput(e.target.value)}
                placeholder="npub1... or pubkey (hex)"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddModerator();
                  }
                }}
              />
              <Button
                size="sm"
                onClick={handleAddModerator}
                variant="outline"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Relays */}
          <div className="space-y-3">
            <Label>Preferred Relays</Label>
            <div className="space-y-2">
              {draft.relays.map((url) => (
                <div
                  key={url}
                  className="flex items-center justify-between bg-muted rounded-lg p-3"
                >
                  <span className="text-xs font-mono truncate">{url}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveRelay(url)}
                    className="h-6 w-6 p-0 text-destructive hover:bg-destructive/20"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                value={newRelayInput}
                onChange={(e) => setNewRelayInput(e.target.value)}
                placeholder="wss://relay.url"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddRelay();
                  }
                }}
              />
              <Button
                size="sm"
                onClick={handleAddRelay}
                variant="outline"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button
              onClick={handlePublish}
              disabled={isPublishing}
              className="flex-1"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
            <Button
              onClick={onClose}
              variant="outline"
              disabled={isPublishing}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

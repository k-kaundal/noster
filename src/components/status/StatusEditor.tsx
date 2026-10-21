import { useState } from 'react';
import { Smile, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePublishStatus, useClearStatus } from '@/hooks/usePublishStatus';
import { useUserStatuses } from '@/hooks/useUserStatuses';

/**
 * How long a general status lasts when the person picks one.
 *
 * Damus exposes a picker: Never, 30m, 1h, 4h, 1d, 1w. The default here is
 * 4 hours — long enough to mean "still doing it", short enough that
 * forgetting to clear it does not leave it up tomorrow.
 */
const EXPIRY_OPTIONS = [
  { label: 'Never', value: 0 },
  { label: '30 minutes', value: 30 * 60 },
  { label: '1 hour', value: 60 * 60 },
  { label: '4 hours', value: 4 * 60 * 60 },
  { label: '1 day', value: 24 * 60 * 60 },
  { label: '1 week', value: 7 * 24 * 60 * 60 },
] as const;

/**
 * The dialog for setting your own status.
 *
 * Opened from the profile menu, it writes a kind 30315 with the type and
 * optional link the person chose. Clearing is the same event with empty
 * content and only the `d` tag, which is the only way to make a relay stop
 * holding it that does not depend on the relay honouring a deletion request.
 */
export function StatusEditor({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useCurrentUser();
  const { general, music } = useUserStatuses(user?.pubkey);
  const publish = usePublishStatus();
  const clear = useClearStatus();

  const [type, setType] = useState<'general' | 'music'>('general');
  const [content, setContent] = useState('');
  const [reference, setReference] = useState('');
  const [emoji, setEmoji] = useState('');
  const [expirySeconds, setExpirySeconds] = useState<number>(4 * 60 * 60);

  const current = type === 'general' ? general : music;

  const handleOpen = (next: boolean) => {
    if (next) {
      setContent(current?.content ?? '');
      setReference(current?.reference ?? '');
      setEmoji(current?.statusEmoji ?? '');
    }
    onOpenChange(next);
  };

  const handleSave = async () => {
    if (!content.trim() && !emoji.trim()) return;

    await publish.mutateAsync({
      type,
      content: content.trim(),
      reference: reference.trim() || undefined,
      statusEmoji: emoji.trim() || undefined,
      expiresInSeconds: expirySeconds > 0 ? expirySeconds : undefined,
    });

    onOpenChange(false);
  };

  const handleClear = async () => {
    await clear.mutateAsync(type);
    onOpenChange(false);
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smile className="h-5 w-5" />
            Set a status
          </DialogTitle>
          <DialogDescription>
            A short line people see next to your name. Clears itself when you
            say, or when the time runs out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="status-type">Type</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as 'general' | 'music')}
              >
                <SelectTrigger id="status-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="music">Listening to</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status-expiry">Clear after</Label>
              <Select
                value={String(expirySeconds)}
                onValueChange={(value) => setExpirySeconds(Number(value))}
              >
                <SelectTrigger id="status-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status-emoji">Emoji (optional)</Label>
            <Input
              id="status-emoji"
              placeholder="🎧"
              value={emoji}
              onChange={(event) => setEmoji(event.target.value)}
              maxLength={4}
              className="w-24 text-center text-lg"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status-content">What are you up to?</Label>
            <Input
              id="status-content"
              placeholder={
                type === 'music' ? 'A song or album' : 'At lunch, reading, working…'
              }
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status-reference">Link (optional)</Label>
            <Input
              id="status-reference"
              placeholder="https://…"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              type="url"
            />
          </div>

          <div className="flex items-center justify-between gap-2 border-t pt-4">
            {current ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={clear.isPending}
              >
                <X className="mr-1 h-4 w-4" />
                Clear current
              </Button>
            ) : (
              <span />
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={(!content.trim() && !emoji.trim()) || publish.isPending}
              >
                {publish.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

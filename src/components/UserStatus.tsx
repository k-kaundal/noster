import { useState } from 'react';
import { Music, Smile, X } from 'lucide-react';

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
import type { UserStatus } from '@/lib/nip38';

/**
 * The little "what are you up to" line under a name.
 *
 * Rendered inline next to a username or in a profile header, it reads the
 * general and music statuses for a person and shows whichever is active. An
 * empty render is fine — most people have never set one, and a blank gap
 * where a status would go is the expected state.
 */
export function UserStatusLine({
  pubkey,
  className,
}: {
  pubkey: string;
  className?: string;
}) {
  const { general, music } = useUserStatuses(pubkey);

  if (!general && !music) return null;

  return (
    <div className={className}>
      {general && <StatusBadge status={general} />}
      {music && <StatusBadge status={music} icon={<Music className="h-3 w-3" />} />}
    </div>
  );
}

function StatusBadge({
  status,
  icon,
}: {
  status: UserStatus;
  icon?: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {icon}
      <span className="truncate">{status.content}</span>
      {status.reference && (
        <a
          href={status.reference}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          ↗
        </a>
      )}
    </span>
  );
}

/**
 * The dialog for setting your own status.
 *
 * Opened from the profile menu, it writes a kind 30315 with the type and
 * optional link the person chose. Clearing is the same event with empty
 * content, which is the only way to make a relay stop holding it that does
 * not depend on the relay honouring a deletion request.
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

  const current = type === 'general' ? general : music;

  const handleOpen = (next: boolean) => {
    if (next) {
      setContent(current?.content ?? '');
      setReference(current?.reference ?? '');
    }
    onOpenChange(next);
  };

  const handleSave = async () => {
    if (!content.trim()) return;

    await publish.mutateAsync({
      type,
      content: content.trim(),
      reference: reference.trim() || undefined,
      // Six hours — long enough to mean "still doing it", short enough that
      // forgetting to clear it does not leave it up tomorrow
      expiresInSeconds: 6 * 60 * 60,
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
            A short line people see next to your name. Clears itself after six
            hours unless you say otherwise.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="status-type">Type</Label>
            <Select value={type} onValueChange={(value) => setType(value as 'general' | 'music')}>
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
            <Label htmlFor="status-content">What are you up to?</Label>
            <Input
              id="status-content"
              placeholder={type === 'music' ? 'A song or album' : 'At lunch, reading, working…'}
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

          <div className="flex items-center justify-between gap-2">
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
                disabled={!content.trim() || publish.isPending}
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

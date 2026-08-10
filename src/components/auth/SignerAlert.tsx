import { useState } from 'react';
import { useNostrLogin } from '@nostrify/react/login';
import { CloudOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useSignerHealth } from '@/hooks/useSignerHealth';
import { useToast } from '@/hooks/useToast';

/**
 * Telling someone their remote signer has gone, before they need it.
 *
 * A dropped NIP-46 session used to fail at the moment of signing: you wrote a
 * post, pressed publish, and got a timeout with no explanation and no way
 * forward. Nothing about that says "the app on your phone is closed", which is
 * usually what happened, and nothing about it offers the fix.
 *
 * The banner is not a modal. Reading works perfectly well with a dead signer,
 * and blocking the whole app over something that only matters when you go to
 * write would be a worse trade than the silence it replaces.
 */
export function SignerAlert() {
  const { user } = useCurrentUser();
  const { isUnreachable, recheck } = useSignerHealth();
  const { logins, removeLogin } = useNostrLogin();
  const login = useLoginActions();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isUnreachable || !user) return null;

  const reconnect = async () => {
    if (!uri.startsWith('bunker://')) {
      setError('A bunker URI starts with bunker://');
      return;
    }

    setConnecting(true);
    setError(null);

    /**
     * The stale logins are noted before connecting, not after.
     *
     * Reconnecting adds a second login for the same key, and leaving the dead
     * one behind would put two identical rows in the account switcher, one of
     * which silently cannot sign. Which ones were stale is only knowable
     * before the new one joins them.
     */
    const stale = logins
      .filter((entry) => entry.pubkey === user.pubkey)
      .map((entry) => entry.id);

    try {
      await login.bunker(uri);

      for (const id of stale) removeLogin(id);

      setUri('');
      setOpen(false);
      await recheck();

      toast({
        title: 'Signer reconnected',
        description: 'You can post again.',
      });
    } catch (e) {
      setError(
        (e as Error)?.message ||
          'That bunker did not answer. Check the URI and that the signer app is open.'
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <>
      <div className="border-b border-warning/40 bg-warning/10">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 py-2 text-sm">
          <CloudOff className="h-4 w-4 shrink-0 text-warning-foreground" />
          <p className="min-w-0 flex-1 text-warning-foreground">
            Your remote signer isn't answering. You can read, but nothing can be
            signed until it reconnects.
          </p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Reconnect
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void recheck()}>
            Try again
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reconnect your signer</DialogTitle>
            <DialogDescription>
              Open the app holding your key and copy a fresh bunker URI from it.
              You stay logged in as the same account — this only replaces the
              connection.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="reconnect-uri">Bunker URI</Label>
            <Input
              id="reconnect-uri"
              value={uri}
              onChange={(event) => {
                setUri(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void reconnect();
              }}
              placeholder="bunker://"
              autoComplete="off"
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void reconnect()} disabled={connecting || !uri.trim()}>
              {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

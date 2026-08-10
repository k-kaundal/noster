import { useState } from 'react';
import { BadgeCheck, Check, Copy, Loader2, Plus, Trash2, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useIdentity } from '@/hooks/useIdentity';
import { useToast } from '@/hooks/useToast';
import {
  ADDRESS_DOMAIN,
  describeUsernameProblem,
  suggestUsername,
  validateUsername,
} from '@/lib/lightningAddress';

/**
 * Every address the wallet receives at.
 *
 * One wallet can answer to several names, and it usually ends up doing so —
 * a name claimed on the way in, a nicer one bought later, one handed out to a
 * particular audience. All of them keep working, which is the useful part and
 * also the dangerous part: the app used to show exactly one and silently drop
 * the rest, so an address someone had given people was invisible here and
 * there was no way to retire it.
 *
 * Two things are separable and were previously conflated: which addresses
 * exist, and which one the profile tells the rest of Nostr to zap. Both are
 * shown, and the second is a choice rather than a consequence of ordering.
 */
export function AddressList() {
  const { lightning, nip5 } = useIdentity();
  const { toast } = useToast();

  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // Which row is mid-publish, so one click does not spin every button on the
  // list — the mutation is shared, the intent is not
  const [publishing, setPublishing] = useState<string | null>(null);

  const addresses = lightning.addresses;
  if (!addresses.length) return null;

  const problem = validateUsername(username);
  const showProblem = touched && !!problem;
  const taken = addresses.some((entry) => entry.username === username);

  const add = async () => {
    await lightning.claim(username).catch(() => {});
    setUsername('');
    setTouched(false);
    setAdding(false);
  };

  const pending = addresses.find((entry) => entry.link.id === confirmRemove);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {addresses.length === 1 ? 'Your address' : 'Your addresses'}
        </p>
        {!adding && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add another
          </Button>
        )}
      </div>

      <ul className="space-y-2">
        {addresses.map((entry) => (
          <li
            key={entry.link.id}
            className="flex items-center gap-2 rounded-lg border p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{entry.address}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {entry.onProfile && (
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-success/15 text-success hover:bg-success/20"
                  >
                    <Zap className="h-3 w-3" />
                    Zaps land here
                  </Badge>
                )}
                {entry.preferred && (
                  <Badge variant="outline" className="gap-1">
                    <BadgeCheck className="h-3 w-3" />
                    {nip5.identifier}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {!entry.onProfile && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={lightning.isPublishing}
                  onClick={() => {
                    setPublishing(entry.address);
                    void lightning
                      .setProfileAddress(entry.address)
                      .catch(() => {})
                      .finally(() => setPublishing(null));
                  }}
                >
                  {publishing === entry.address ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    'Use for zaps'
                  )}
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                aria-label={`Copy ${entry.address}`}
                onClick={async () => {
                  await navigator.clipboard.writeText(entry.address);
                  toast({ title: 'Copied to clipboard' });
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>

              {/* The address the profile advertises has no delete button:
                  removing it would leave every zap in the network pointed at
                  a name that no longer resolves. Point them somewhere else
                  first, and it becomes deletable like any other. */}
              {!entry.onProfile && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${entry.address}`}
                  onClick={() => setConfirmRemove(entry.link.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {adding && (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="flex items-center gap-2">
            <Input
              value={username}
              onChange={(event) => {
                setUsername(suggestUsername(event.target.value));
                if (!touched) setTouched(true);
              }}
              onBlur={() => setTouched(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !problem && !taken) void add();
              }}
              placeholder="another-name"
              aria-invalid={showProblem}
              aria-label="New address name"
              className="max-w-[10rem]"
              autoFocus
            />
            <span className="flex-1 truncate text-sm text-muted-foreground">
              @{ADDRESS_DOMAIN}
            </span>
          </div>

          {showProblem ? (
            <p className="text-xs text-destructive">
              {describeUsernameProblem(problem)}
            </p>
          ) : taken ? (
            <p className="text-xs text-muted-foreground">
              You already have that one.
            </p>
          ) : username ? (
            <p className="flex items-center gap-1 text-xs text-success">
              <Check className="h-3 w-3" />
              Available to claim
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void add()}
              disabled={!username || !!problem || taken || lightning.isClaiming}
            >
              {lightning.isClaiming && (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              )}
              Claim
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setUsername('');
                setTouched(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <AlertDialog
        open={!!confirmRemove}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pending?.address}?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone who saved this address will stop being able to pay you at
              it, and the name goes back into the pool for someone else to
              claim. Payments already sent have arrived.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmRemove) {
                  void lightning.remove(confirmRemove).catch(() => {});
                }
                setConfirmRemove(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

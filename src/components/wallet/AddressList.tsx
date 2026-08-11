import { useState } from 'react';
import { BadgeCheck, Copy, Loader2, Lock, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useIdentity } from '@/hooks/useIdentity';
import { useToast } from '@/hooks/useToast';

/**
 * Every address the wallet receives at.
 *
 * One wallet can answer to several names, and it usually ends up doing so —
 * the name assigned on the way in, a bought one later, one handed out to a
 * particular audience. All of them keep working, which is the useful part: the
 * app used to show exactly one and silently drop the rest, so an address
 * somebody had given out was invisible here.
 *
 * Two things are separable and were previously conflated: which addresses
 * exist, and which one the profile tells the rest of Nostr to zap. Both are
 * shown, and the second is a choice rather than a consequence of ordering.
 *
 * Nothing on this list can be deleted, and nothing new can be claimed from it.
 * Both used to be here and both were wrong — see the notes at each.
 */
export function AddressList() {
  const { lightning, nip5, onFreeName } = useIdentity();
  const { toast } = useToast();

  // Which row is mid-publish, so one click does not spin every button on the
  // list — the mutation is shared, the intent is not
  const [publishing, setPublishing] = useState<string | null>(null);

  const addresses = lightning.addresses;
  if (!addresses.length) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {addresses.length === 1 ? 'Your address' : 'Your addresses'}
      </p>

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

              {/* There was a delete button here. Deleting a pay link does not
                  just stop a name resolving — it puts the name back in the
                  pool, so the next person to claim it receives the zaps aimed
                  at this one. Profiles, saved contacts and printed codes all
                  outlive the link and none of them find out. Publishing a
                  different address is the reversible way to stop receiving
                  here, and it costs nobody their name. */}
            </div>
          </li>
        ))}
      </ul>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          {addresses.length === 1 ? 'This address is' : 'These are'} yours for
          good. Names are never released or reassigned, so anything you hand
          out keeps working.
        </span>
      </p>

      {/* There was an "add another" box here that claimed any free name on the
          spot, which gave away the exact thing the verified-name flow charges
          for. A chosen name is bought below, and buying one issues the address
          to match — so this says where that happens instead of duplicating it
          badly. */}
      {onFreeName && (
        <p className="text-xs text-muted-foreground">
          Want an address that says your name? Reserve a verified name below and
          it comes with a matching one — this one keeps working alongside it.
        </p>
      )}
    </div>
  );
}

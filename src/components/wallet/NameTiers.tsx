import { useState } from 'react';
import { ArrowDownLeft, Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VerificationBadge, VerificationMark } from '@/components/VerificationBadge';
import { AddressReceiveDialog } from '@/components/wallet/AddressReceiveDialog';
import { useIdentity } from '@/hooks/useIdentity';
import { useToast } from '@/hooks/useToast';
import { describeTier, leadAddress, nextTier, rankAddresses } from '@/lib/tiers';
import { cn } from '@/lib/utils';

/**
 * Every name somebody holds, best first, with the best one in charge.
 *
 * The page used to show the free address at the top because it was issued
 * first, so a person who had bought their way up found what they paid for
 * somewhere below what they were given. Ranking fixes the default; the choice
 * underneath keeps it a default rather than a rule, because pointing zaps at
 * a particular address is a decision somebody is allowed to make for reasons
 * this app cannot see.
 */
export function NameTiers() {
  const { lightning } = useIdentity();
  const { toast } = useToast();

  const [receivingAt, setReceivingAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);

  const held = lightning.addresses.map((entry) => entry.address);

  const ranked = rankAddresses(held);
  if (!ranked.length) return null;

  // What the profile says, so the ranking never overrules a real decision
  const lead = leadAddress(held, lightning.profileAddress);
  const upsell = nextTier(ranked[0]?.tier ?? null);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your names
        </p>
        <p className="text-xs text-muted-foreground">
          {ranked.length === 1 ? '1 name' : `${ranked.length} names`}
        </p>
      </div>

      <ul className="space-y-2">
        {ranked.map((entry) => {
          const isLead = entry.address === lead?.address;
          const onProfile = lightning.profileAddress === entry.address;

          return (
            <li
              key={entry.address}
              className={cn(
                'rounded-xl border p-3 transition-colors',
                isLead
                  ? 'border-primary/40 bg-gradient-to-br from-primary/5 to-transparent'
                  : 'bg-card'
              )}
            >
              <div className="flex items-center gap-2">
                <VerificationMark tier={entry.tier} className="shrink-0" />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.address}</p>
                  <p className="text-xs text-muted-foreground">
                    {describeTier(entry.tier).blurb}
                  </p>
                </div>

                <VerificationBadge tier={entry.tier} className="shrink-0" />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {onProfile ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success-strong">
                    <Check className="h-3 w-3" />
                    Zaps land here
                  </span>
                ) : (
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
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setReceivingAt(entry.address)}
                >
                  <ArrowDownLeft className="mr-1 h-3 w-3" />
                  Receive
                </Button>

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
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        {/* Carried over from the list this replaced. It is the reassurance that
            makes handing an address out reasonable, and it applies to every
            tier including the free one. */}
        Every one of these is yours for good — names are never released or
        reassigned, so anything you hand out keeps working.
      </p>

      {/* Only when there is something above what they hold. An upsell shown to
          somebody already on the top tier reads as the app not knowing what
          they bought. */}
      {upsell && (
        <p className="text-xs text-muted-foreground">
          A verified name gets you your own name and a ✓ on every post — below.
        </p>
      )}

      <AddressReceiveDialog
        address={receivingAt ?? ''}
        open={!!receivingAt}
        onOpenChange={(open) => !open && setReceivingAt(null)}
      />
    </div>
  );
}

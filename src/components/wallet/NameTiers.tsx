import { useState } from 'react';
import { ArrowDownLeft, Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VerificationBadge, VerificationMark } from '@/components/VerificationBadge';
import { AddressReceiveDialog } from '@/components/wallet/AddressReceiveDialog';
import { useIdentity } from '@/hooks/useIdentity';
import { useToast } from '@/hooks/useToast';
import { NIP5_DOMAIN, isNip5Configured, nip5Identifier } from '@/lib/nip5';
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
  /*
   * `addresses` is named as the identities they are, which `useIdentity`
   * decides. Doing that here instead left the page disagreeing with itself:
   * this list said `dev@getzap.me` while the check above it still compared the
   * profile against `dev@ln.nostrfeed.com`, and announced a correct profile
   * out of date.
   */
  const { lightning, nip5, addresses } = useIdentity();
  const { toast } = useToast();

  /**
   * The names that really are verified, so nothing else can look it.
   *
   * The tier used to be read off the string: a local part somebody chose, at
   * one of our domains, was "Verified". That has no way to tell a bought name
   * from the pay link behind one, and it awarded a ✓ that no client would
   * honour — verification is a lookup against the domain, and nothing was
   * bought at the domain the link was being shown under.
   */
  const verified = nip5.addresses
    .filter((address) => address.active)
    .map((address) => nip5Identifier(address) ?? '')
    .filter(Boolean);

  const [receivingAt, setReceivingAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);

  const held = addresses.map((entry) => entry.address);

  /**
   * The domains these addresses are actually at.
   *
   * Every one of them came off a pay link on this account, which is a stronger
   * statement than any setting can make: the server issued it, so it is ours
   * whatever the configuration currently says. Ranking against configuration
   * alone means an operator who edits or removes a domain setting deletes
   * people's addresses from the page listing what they own — the address keeps
   * working and simply stops being shown, which is the worst of both.
   */
  const domains = {
    named: [...new Set(addresses.map((entry) => entry.domain))].filter(Boolean),
  };

  /**
   * Which wallet each address pays into.
   *
   * Only worth showing once there are several. With one wallet the answer is
   * the same for every row and adds a line of noise; with two it is the
   * difference between money arriving where somebody expects it and money
   * arriving somewhere they have to go looking for.
   */
  const wallets = Object.keys(lightning.walletNames);
  const walletFor = new Map(
    addresses.map((entry) => [
      entry.address,
      wallets.length > 1
        ? lightning.walletNames[entry.link.wallet]
        : undefined,
    ])
  );

  const ranked = rankAddresses(held, domains, verified);
  if (!ranked.length) return null;

  // What the profile says, so the ranking never overrules a real decision
  const lead = leadAddress(held, lightning.profileAddress, domains, verified);
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
                <VerificationMark
                  tier={entry.tier}
                  domain={entry.domain}
                  className="shrink-0"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.address}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {walletFor.get(entry.address)
                      ? `Pays into ${walletFor.get(entry.address)}`
                      : describeTier(entry.tier, { domain: entry.domain })
                          .blurb}
                  </p>
                </div>

                <VerificationBadge
                  tier={entry.tier}
                  domain={entry.domain}
                  className="shrink-0"
                />
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
      {upsell && isNip5Configured() && (
        <p className="text-xs text-muted-foreground">
          {/* The domain named rather than implied: "a verified name" is an
              abstraction, and `you@getzap.me` is the thing being sold. */}
          A name at <span className="font-medium">{NIP5_DOMAIN}</span> is yours
          alone, and puts a ✓ on every post — below.
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

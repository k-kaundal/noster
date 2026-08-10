import { useState } from 'react';
import { AtSign, BadgeCheck, Check, Copy, Loader2, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { AddressList } from '@/components/wallet/AddressList';
import { ExternalAddress } from '@/components/wallet/ExternalAddress';
import { PortableAddress } from '@/components/wallet/PortableAddress';
import { Nip5Section } from '@/components/wallet/Nip5Section';
import { useIdentity } from '@/hooks/useIdentity';
import { useToast } from '@/hooks/useToast';
import {
  ADDRESS_DOMAIN,
  describeUsernameProblem,
  formatAddress,
  suggestUsername,
  validateUsername,
} from '@/lib/lightningAddress';

/**
 * Someone's name here, in one place.
 *
 * This was two cards — "Lightning address" and "Verified name" — which is two
 * answers to a question nobody asks twice. What people want is their name, and
 * for both money and identity to arrive at it. So the card leads with whatever
 * their name currently is, says what is missing, and offers the upgrade
 * underneath rather than beside.
 */
export function IdentityCard() {
  const identity = useIdentity();

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-br from-primary/5 via-transparent to-transparent pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <AtSign className="h-4 w-4 text-primary" />
          </div>
          Your name
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5 pt-4">
        {identity.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-3 w-48 rounded" />
          </div>
        ) : identity.status.tier === 'none' ||
          identity.status.tier === 'external' ? (
          /* Someone paid at an address from elsewhere has no address *here*,
             so the offer still applies — and the section below already shows
             the one they have, rather than this badging it as ours */
          <ClaimForm />
        ) : (
          <>
            <CurrentIdentity />
            <Separator className="my-4" />
            <AddressList />
          </>
        )}

        <Separator className="my-4" />

        {/* Offered whether or not they have one of ours: someone who arrived
            with an address already should not have to claim one here first */}
        <ExternalAddress />

        <Separator className="my-4" />

        {/* The third kind: a name whose destination is a setting rather than
            a consequence of who issued it */}
        <PortableAddress />

        <Separator className="my-4" />

        <Nip5Section />
      </CardContent>
    </Card>
  );
}

function CurrentIdentity() {
  const {
    status,
    nip5,
    lightning,
    publish,
    isPublishing,
    alignLightningAddress,
    isAligning,
  } = useIdentity();
  const { toast } = useToast();

  if (!status.primary) return null;

  const verified = status.tier === 'verified';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border bg-gradient-to-br from-primary/5 to-transparent p-4 transition-all hover:border-primary/40">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            {verified ? 'Verified identity' : 'Your address'}
          </p>
          <p className="text-lg font-semibold truncate">{status.primary}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {verified ? (
            <Badge className="gap-1 bg-success/15 text-success hover:bg-success/20">
              <BadgeCheck className="h-3 w-3" />
              <span className="hidden sm:inline">Verified</span>
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-blue-500/15 text-blue-600 hover:bg-blue-500/25">
              Free
            </Badge>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(status.primary!);
              toast({ title: 'Copied to clipboard' });
            }}
            aria-label="Copy"
            className="hover:bg-primary/10"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {status.unpublished.length > 0 && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/8 p-4 backdrop-blur-sm">
          <p className="text-sm text-warning-foreground">
            {/* Which half is behind changes what is actually broken, so it is
                worth saying rather than "your profile is out of date" */}
            {status.unpublished.length === 2
              ? "Your profile doesn't advertise this yet."
              : status.unpublished[0] === 'lud16'
                ? 'Your profile zap address is out of date.'
                : "Your profile doesn't claim this verified name."}
          </p>
          <Button
            size="sm"
            onClick={() => void publish().catch(() => {})}
            disabled={isPublishing}
            className="w-full"
          >
            {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish now
          </Button>
        </div>
      )}

      {status.unpublished.length === 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success">
          <Check className="h-4 w-4 shrink-0" />
          <span>
            {verified
              ? 'Live on your profile — verified with ✓ and zaps arrive here.'
              : 'Live on your profile — anyone can zap you here.'}
          </span>
        </p>
      )}

      {status.mismatched && (
        <div className="rounded-lg border border-blue-200/50 bg-blue-50/50 p-4 dark:border-blue-900/30 dark:bg-blue-950/20">
          <p className="mb-3 text-sm text-foreground">
            Zaps go to{' '}
            <code className="inline rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {lightning.address}
            </code>
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void alignLightningAddress().catch(() => {})}
            disabled={isAligning}
            className="w-full"
          >
            {isAligning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Move to {nip5.identifier}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Claiming the free address, for someone with no name at all yet.
 *
 * Pre-filled, because the point is that this takes one tap. The suggestion
 * comes from their profile name, or from their key when they have no profile —
 * either way it is stable, so it doesn't change between two looks at the page.
 */
function ClaimForm() {
  const { lightning, suggestion, status } = useIdentity();
  const elsewhere = status.tier === 'external';

  const [username, setUsername] = useState(suggestion);
  const [touched, setTouched] = useState(false);

  const problem = validateUsername(username);
  const showProblem = touched && !!problem;
  const isValid = !problem && username.length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-gradient-to-br from-blue-50 to-blue-50/50 p-4 dark:from-blue-950/30 dark:to-blue-950/10">
        <p className="text-sm">
          <span className="font-medium">
            {elsewhere ? 'Want one here as well?' : 'Start receiving zaps.'}
          </span>{' '}
          <span className="text-muted-foreground">
            {elsewhere
              ? 'Your zaps already arrive elsewhere. An address here is free, yours for good, and can be switched to whenever you like.'
              : 'Pick a name, and anyone on Nostr can pay you. Free and yours for good.'}
          </span>
        </p>
      </div>

      <div className="space-y-3">
        <Label htmlFor="ln-username" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your address
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="ln-username"
            value={username}
            onChange={(event) => {
              setUsername(suggestUsername(event.target.value));
              if (!touched) setTouched(true);
            }}
            onBlur={() => setTouched(true)}
            placeholder="satoshi"
            aria-invalid={showProblem}
            className="max-w-[10rem] transition-all"
          />
          <span className="flex-1 truncate text-sm font-medium text-foreground">
            @{ADDRESS_DOMAIN}
          </span>
        </div>

        {showProblem ? (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <span className="shrink-0 mt-0.5">⚠</span>
            {describeUsernameProblem(problem)}
          </p>
        ) : username ? (
          <p className="text-xs text-success flex items-center gap-1">
            <Check className="h-3 w-3" />
            {formatAddress(username)} is ready
          </p>
        ) : null}
      </div>

      <Button
        onClick={() => void lightning.claim(username).catch(() => {})}
        disabled={!isValid || lightning.isClaiming}
        className="w-full"
        size="lg"
      >
        {lightning.isClaiming ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Wand2 className="mr-2 h-4 w-4" />
        )}
        {lightning.isClaiming ? 'Claiming...' : 'Claim my address'}
      </Button>
    </div>
  );
}

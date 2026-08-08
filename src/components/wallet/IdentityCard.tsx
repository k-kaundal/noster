import { useState } from 'react';
import { AtSign, BadgeCheck, Check, Copy, Loader2, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AtSign className="h-4 w-4" />
          Your name
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {identity.isLoading ? (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-4 w-56" />
          </>
        ) : identity.status.tier === 'none' ? (
          <ClaimForm />
        ) : (
          <CurrentIdentity />
        )}

        <Separator />

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
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border p-3">
        <span className="min-w-0 flex-1 truncate font-medium">
          {status.primary}
        </span>

        {verified ? (
          <Badge className="shrink-0 gap-1">
            <BadgeCheck className="h-3 w-3" />
            Verified
          </Badge>
        ) : (
          <Badge variant="secondary" className="shrink-0">
            Free
          </Badge>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(status.primary!);
            toast({ title: 'Copied' });
          }}
          aria-label="Copy"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>

      {status.unpublished.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm">
            {/* Which half is behind changes what is actually broken, so it is
                worth saying rather than "your profile is out of date" */}
            {status.unpublished.length === 2
              ? "Your profile doesn't advertise this yet, so nobody can zap you and nobody sees the ✓."
              : status.unpublished[0] === 'lud16'
                ? 'Your profile points zaps somewhere else.'
                : "Your profile doesn't claim this name, so nobody sees the ✓."}
          </p>
          <Button
            size="sm"
            onClick={() => void publish().catch(() => {})}
            disabled={isPublishing}
          >
            {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish to my profile
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" />
          {verified
            ? 'On your profile — you show as verified and zaps land here.'
            : 'On your profile — anyone on Nostr can zap you.'}
        </p>
      )}

      {/* Someone who claimed a free address before buying a name still has
          zaps arriving at the old one */}
      {status.mismatched && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <p className="min-w-0 text-sm text-muted-foreground">
            Zaps still go to{' '}
            <span className="font-medium text-foreground">
              {lightning.address}
            </span>
            .
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void alignLightningAddress().catch(() => {})}
            disabled={isAligning}
          >
            {isAligning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Move them to {nip5.identifier}
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
  const { lightning, suggestion } = useIdentity();

  const [username, setUsername] = useState(suggestion);
  const [touched, setTouched] = useState(false);

  const problem = validateUsername(username);
  const showProblem = touched && !!problem;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Pick a name and people can zap you at it from any Nostr client, free and
        yours for good. A verified name with the ✓ is below.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="ln-username" className="text-xs">
          Your address
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="ln-username"
            value={username}
            onChange={(event) =>
              // Typing an uppercase or spaced name shouldn't produce an
              // address that silently differs from what was typed
              setUsername(suggestUsername(event.target.value))
            }
            onBlur={() => setTouched(true)}
            placeholder="satoshi"
            aria-invalid={showProblem}
            className="max-w-[12rem]"
          />
          <span className="truncate text-sm text-muted-foreground">
            @{ADDRESS_DOMAIN}
          </span>
        </div>

        {showProblem ? (
          <p className="text-xs text-destructive">
            {describeUsernameProblem(problem)}
          </p>
        ) : (
          username && (
            <p className="text-xs text-muted-foreground">
              You'll be {formatAddress(username)}
            </p>
          )
        )}
      </div>

      <Button
        onClick={() => void lightning.claim(username).catch(() => {})}
        disabled={!!problem || lightning.isClaiming}
      >
        {lightning.isClaiming ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Wand2 className="mr-2 h-4 w-4" />
        )}
        Claim my address
      </Button>
    </div>
  );
}

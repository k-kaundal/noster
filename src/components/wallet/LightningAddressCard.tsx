import { useState } from 'react';
import { AtSign, Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useLightningAddress } from '@/hooks/useLightningAddress';
import { useToast } from '@/hooks/useToast';
import {
  ADDRESS_DOMAIN,
  describeUsernameProblem,
  formatAddress,
  suggestUsername,
  validateUsername,
} from '@/lib/lightningAddress';

/** Claim and manage the user's `name@domain` lightning address. */
export function LightningAddressCard() {
  const {
    address,
    isLoading,
    isOnProfile,
    profileAddress,
    claim,
    isClaiming,
    publishToProfile,
    isPublishing,
    suggestedFrom,
  } = useLightningAddress();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AtSign className="h-4 w-4" />
          Lightning address
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {address ? (
          <ClaimedAddress
            address={address}
            isOnProfile={isOnProfile}
            profileAddress={profileAddress}
            onPublish={publishToProfile}
            isPublishing={isPublishing}
          />
        ) : (
          <ClaimForm
            suggestedFrom={suggestedFrom}
            onClaim={claim}
            isClaiming={isClaiming}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ClaimedAddress({
  address,
  isOnProfile,
  profileAddress,
  onPublish,
  isPublishing,
}: {
  address: string;
  isOnProfile: boolean;
  profileAddress?: string;
  onPublish: () => void;
  isPublishing: boolean;
}) {
  const { toast } = useToast();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border p-3">
        <span className="min-w-0 flex-1 truncate font-medium">{address}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(address);
            toast({ title: 'Address copied' });
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isOnProfile ? (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" />
          Published to your profile — anyone on Nostr can zap you.
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm">
            {profileAddress
              ? `Your profile still points at ${profileAddress}. Zaps go there, not here.`
              : 'Your profile doesn’t advertise this address yet, so nobody can zap you with it.'}
          </p>
          <Button size="sm" onClick={onPublish} disabled={isPublishing}>
            {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish to my profile
          </Button>
        </div>
      )}
    </div>
  );
}

function ClaimForm({
  suggestedFrom,
  onClaim,
  isClaiming,
}: {
  suggestedFrom: string;
  onClaim: (username: string) => Promise<unknown>;
  isClaiming: boolean;
}) {
  const [username, setUsername] = useState(() => suggestUsername(suggestedFrom));
  const [touched, setTouched] = useState(false);

  const problem = validateUsername(username);
  const showProblem = touched && !!problem;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Pick a name and people can zap you at it from any Nostr client, without
        you running anything.
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
        onClick={() => onClaim(username)}
        disabled={!!problem || isClaiming}
      >
        {isClaiming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Claim address
      </Button>
    </div>
  );
}

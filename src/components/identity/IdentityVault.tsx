import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import {
  BadgeCheck,
  Check,
  Copy,
  KeyRound,
  Link2,
  Lock,
  Radio,
  Zap,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLoggedInAccounts } from '@/hooks/useLoggedInAccounts';
import { useRelays } from '@/hooks/useRelays';
import { useRelayHealth } from '@/hooks/useRelayHealth';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { relayDisplayName } from '@/lib/relay';
import type { SignerMethod } from '@/lib/session';
import { cn } from '@/lib/utils';

/**
 * What this browser can do with your key, and where your name points.
 *
 * Every row here used to be invented. It listed "MacBook Pro", "iPhone 15 Pro"
 * and a "Ledger Nano X" as devices authorised to sign with your key; three apps
 * holding permissions including "Read DMs"; four relays with made-up latencies;
 * and a session history of events that never happened. It also labelled a field
 * "Public Key (npub)" and printed the raw hex, and showed everybody the same
 * hardcoded `user@nostrfeed.com` as their lightning address.
 *
 * On a page about the security of somebody's identity that is not a
 * placeholder. A fabricated signing device is an invitation to panic about a
 * key that was never at risk, and a fabricated "Read DMs" grant is worse:
 * reassurance that revoking it would have done something.
 *
 * So this shows what is actually knowable from here, and says plainly where
 * nothing is. See `Unknowable` at the bottom for why two of the four tabs
 * cannot be filled by a client at all.
 */
export function IdentityVault() {
  const { user, metadata } = useCurrentUser();
  const [tab, setTab] = useState('devices');

  if (!user) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            Sign in to see what this browser can do with your key.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <IdentityHeader pubkey={user.pubkey} metadata={metadata} />

      <Card>
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0">
            <VaultTab value="devices" icon={Lock} label="Signing" />
            <VaultTab value="relays" icon={Radio} label="Relays" />
            <VaultTab value="apps" icon={Link2} label="Connected apps" />
          </TabsList>

          <TabsContent value="devices" className="space-y-3 p-6">
            <SigningSessions />
          </TabsContent>

          <TabsContent value="relays" className="space-y-3 p-6">
            <RelayList />
          </TabsContent>

          <TabsContent value="apps" className="p-6">
            <Unknowable />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}

function VaultTab({
  value,
  icon: Icon,
  label,
}: {
  value: string;
  icon: typeof Lock;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="shrink-0 rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary"
    >
      <Icon className="mr-2 h-4 w-4" />
      {label}
    </TabsTrigger>
  );
}

/** The key, and the two names that point at it. */
function IdentityHeader({
  pubkey,
  metadata,
}: {
  pubkey: string;
  metadata?: { name?: string; nip05?: string; lud16?: string };
}) {
  /*
   * Encoded, because the label says npub. This printed `user.pubkey` — the raw
   * hex — under a heading promising an npub, so anyone who copied it pasted
   * something no other client would accept as a profile link.
   */
  const npub = nip19.npubEncode(pubkey);

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-6 py-7">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-medium">
            {metadata?.name || genUserName(pubkey)}
          </h2>
        </div>

        <div className="mt-4 space-y-3">
          <CopyField label="Public key (npub)" value={npub} />

          {/*
            The hex too, because they are not interchangeable: relay filters and
            most APIs take hex, while every client link takes the npub. Somebody
            on this page is usually about to paste one into something, and being
            handed the wrong one is the entire failure.
          */}
          <CopyField label="Public key (hex)" value={pubkey} muted />

          <NameRow
            label="Nostr address (NIP-05)"
            value={metadata?.nip05}
            icon={BadgeCheck}
            missing="Not set on your profile"
          />
          <NameRow
            label="Lightning address"
            value={metadata?.lud16}
            icon={Zap}
            missing="Not set — you cannot be zapped yet"
          />
        </div>
      </div>
    </Card>
  );
}

function CopyField({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Select the text and copy it by hand.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code
          className={cn(
            'min-w-0 flex-1 truncate rounded bg-muted/50 px-3 py-2 font-mono text-xs',
            muted && 'text-muted-foreground'
          )}
        >
          {value}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={copy}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="h-4 w-4 text-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * A name from the profile, or an honest gap.
 *
 * Never a checkmark this app has not earned. The old version printed
 * "✓ Active" beside a hardcoded address for every visitor, which is a claim
 * about somebody's money reaching them.
 */
function NameRow({
  label,
  value,
  icon: Icon,
  missing,
}: {
  label: string;
  value?: string;
  icon: typeof Zap;
  missing: string;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {value ? (
        <p className="flex items-center gap-2 text-sm">
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono">{value}</span>
        </p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{missing}</span>
          <Link to="/settings" className="text-primary hover:underline">
            Set it
          </Link>
        </p>
      )}
    </div>
  );
}

/** How each account signed into *this browser* holds its key. */
const METHOD: Record<SignerMethod, { label: string; detail: string }> = {
  nsec: {
    label: 'Secret key in this browser',
    detail:
      'Your key is stored here and signs without asking. Anything that can read this browser can use it.',
  },
  extension: {
    label: 'Browser extension',
    detail:
      'A NIP-07 extension holds the key and signs on request. This app never sees it.',
  },
  bunker: {
    label: 'Remote signer',
    detail:
      'A NIP-46 bunker holds the key elsewhere and signs on request. Revoke access from the bunker itself.',
  },
  'read-only': {
    label: 'Read-only',
    detail:
      'A public key with no signer, so this session can read but cannot post, zap or sign anything.',
  },
};

/**
 * The accounts signed into this browser, which is the true answer to "what can
 * sign as me".
 *
 * There is no device list to show. A Nostr key leaves no record of where it has
 * been used — that is a property of the protocol, not a gap in this app — so
 * the only signing this page can honestly speak for is the signing it can do
 * itself.
 */
function SigningSessions() {
  const { authors, currentUser } = useLoggedInAccounts();

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Accounts signed in on this browser. Nostr keeps no record of where else
        a key has been used, so nothing outside this browser can be listed here
        — or revoked from here.
      </p>

      {authors.map((account) => {
        const method = METHOD[account.method as SignerMethod] ?? {
          label: 'Unknown signer',
          detail: 'This app does not recognise how this session holds its key.',
        };
        const isCurrent = account.pubkey === currentUser?.pubkey;

        return (
          <div
            key={account.id ?? account.pubkey}
            className={cn(
              'rounded-lg border p-4',
              isCurrent ? 'border-primary/40 bg-primary/[0.03]' : 'bg-muted/20'
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">
                {account.metadata?.name || genUserName(account.pubkey)}
              </p>
              {isCurrent && (
                <Badge variant="secondary" className="text-[10px]">
                  In use
                </Badge>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-[10px]">
                    {method.label}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {method.detail}
                </TooltipContent>
              </Tooltip>
            </div>

            <code className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
              {nip19.npubEncode(account.pubkey)}
            </code>
          </div>
        );
      })}
    </div>
  );
}

/** The relays actually configured, with the health the app actually measured. */
function RelayList() {
  const { relays, primaryUrl } = useRelays();
  const health = useRelayHealth(relays.map((relay) => relay.url));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Where this app reads and publishes for you.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/relays">Manage relays</Link>
        </Button>
      </div>

      {relays.map((relay) => {
        const state = health[relay.url];
        const status = state?.status ?? 'idle';

        return (
          <div
            key={relay.url}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/20 p-4"
          >
            <span
              aria-hidden="true"
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                status === 'online'
                  ? 'bg-success'
                  : status === 'offline'
                    ? 'bg-destructive'
                    : 'bg-muted-foreground/40'
              )}
            />

            <span className="min-w-0 flex-1 truncate text-sm">
              {relayDisplayName(relay.url)}
            </span>

            {relay.url === primaryUrl && (
              <Badge variant="secondary" className="text-[10px]">
                Primary
              </Badge>
            )}

            {/*
              Only a latency that was measured. The old list printed 82ms,
              124ms and 145ms as constants, which is a plausible-looking number
              for a relay that may not even be reachable.
            */}
            {status === 'online' && state?.latency !== undefined && (
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                {state.latency} ms
              </span>
            )}
            {status === 'offline' && (
              <span className="shrink-0 text-xs text-destructive">
                Unreachable
              </span>
            )}

            <span className="shrink-0 text-xs text-muted-foreground">
              {relay.read && relay.write
                ? 'read · write'
                : relay.read
                  ? 'read'
                  : relay.write
                    ? 'write'
                    : 'off'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The tab that cannot be filled, and why.
 *
 * NIP-46 grants live in the bunker, not in the client — an app holding your key
 * does not announce itself to other apps, and nothing in the protocol lets this
 * one enumerate them. The old version listed three apps with permissions
 * including "Read DMs" and a revoke button, which is the most dangerous kind of
 * wrong: it tells you a grant exists and implies you have just removed it.
 */
function Unknowable() {
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Nothing to show, and nothing this app can find out.
      </p>
      <p className="mx-auto max-w-md text-xs text-muted-foreground/80">
        Apps you have given your key to hold that permission themselves — a
        NIP-46 signer does not publish a list, and no Nostr client can read one.
        Revoke access in the signer that granted it: your bunker's own app, or
        your browser extension's settings.
      </p>
    </div>
  );
}

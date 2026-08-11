import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Eye, EyeOff, Gauge, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useDiscoverProviders,
  useSetTrustProviders,
  useTrustProviders,
} from '@/hooks/useTrustedAssertions';
import { genUserName } from '@/lib/genUserName';
import {
  ASSERTION_KINDS,
  METRICS,
  USER_ASSERTION,
  type AssertionKind,
  type TrustProvider,
} from '@/lib/nip85';

const KIND_LABELS: Record<AssertionKind, string> = {
  30382: 'People',
  30383: 'Notes',
  30384: 'Articles and other addressable events',
  30385: 'External things (books, films, sites)',
};

/**
 * Choosing whose scores to believe.
 *
 * This is the whole trust decision, so it is a deliberate act rather than a
 * default. Nothing is pre-selected and no provider is suggested by this app:
 * a client that shipped its own preferred web-of-trust service would be making
 * the one choice the NIP exists to hand to the reader.
 */
export function TrustProviderSettings() {
  const { user } = useCurrentUser();
  const { providers, isLoading } = useTrustProviders();
  const { mutateAsync: save, isPending } = useSetTrustProviders();
  const { data: discovered } = useDiscoverProviders();

  const [kind, setKind] = useState<AssertionKind>(USER_ASSERTION);
  const [tag, setTag] = useState('rank');
  const [key, setKey] = useState('');
  const [relay, setRelay] = useState('');
  const [isPrivate, setPrivate] = useState(false);

  if (!user) return null;

  const hex = toHex(key);

  const add = async () => {
    if (!hex) return;

    const next: TrustProvider = {
      selector: `${kind}:${tag}`,
      kind,
      tag,
      pubkey: hex,
      relay: relay.trim() || undefined,
      isPrivate,
    };

    // Declaring the same key for the same result twice would publish a
    // duplicate tag that means nothing new
    const exists = providers.some(
      (provider) =>
        provider.selector === next.selector && provider.pubkey === next.pubkey
    );

    if (exists) return;

    await save([...providers, next]).catch(() => undefined);
    setKey('');
    setRelay('');
  };

  const remove = async (target: TrustProvider) => {
    await save(
      providers.filter(
        (provider) =>
          !(
            provider.selector === target.selector &&
            provider.pubkey === target.pubkey
          )
      )
    ).catch(() => undefined);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Gauge className="h-4 w-4 text-primary" />
          </div>
          Trusted scoring services
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Some clients show a reputation score next to people and posts. Those
          numbers come from services that read the network and publish signed
          results. Nothing is shown until you name a service here — and a score
          is always that service's opinion, computed however they choose.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : providers.length ? (
          <ul className="space-y-2">
            {providers.map((provider) => (
              <ProviderRow
                key={`${provider.selector}:${provider.pubkey}`}
                provider={provider}
                onRemove={() => remove(provider)}
                busy={isPending}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            None yet, so no scores are shown anywhere.
          </p>
        )}

        <div className="space-y-3 rounded-lg border border-dashed p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="trust-kind">Scores about</Label>
              <Select
                value={String(kind)}
                onValueChange={(value) => {
                  const next = Number.parseInt(value, 10) as AssertionKind;
                  setKind(next);
                  // Result types differ per subject; `rank` is on all of them
                  setTag('rank');
                }}
              >
                <SelectTrigger id="trust-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSERTION_KINDS.map((entry) => (
                    <SelectItem key={entry} value={String(entry)}>
                      {KIND_LABELS[entry]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="trust-tag">Result</Label>
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger id="trust-tag">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS[kind].map((metric) => (
                    <SelectItem key={metric.tag} value={metric.tag}>
                      {metric.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trust-key">Service key</Label>
            <Input
              id="trust-key"
              value={key}
              onChange={(changed) => setKey(changed.target.value)}
              placeholder="npub1… or hex"
            />
            {key.trim() && !hex && (
              <p className="text-xs text-destructive">
                That isn't a public key this app can read.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trust-relay">Relay</Label>
            <Input
              id="trust-relay"
              value={relay}
              onChange={(changed) => setRelay(changed.target.value)}
              placeholder="wss://nip85.nostr.band"
            />
            <p className="text-xs text-muted-foreground">
              Where this service publishes. Often not a relay you read for
              anything else, and it may charge for access.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
            <Label
              htmlFor="trust-private"
              className="flex cursor-pointer items-center gap-2 text-sm font-normal"
            >
              {isPrivate ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              {isPrivate ? 'Private' : 'Public'}
            </Label>
            <Switch
              id="trust-private"
              checked={isPrivate}
              onCheckedChange={setPrivate}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Whose judgement you accept is itself a statement. Private entries
            are encrypted to you and nobody else can read them.
          </p>

          <Button size="sm" onClick={add} disabled={isPending || !hex} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Trust this service
          </Button>
        </div>

        {!!discovered?.length && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Used by people you follow</p>
            <ul className="space-y-1">
              {discovered.slice(0, 6).map(({ provider, count }) => (
                <DiscoveredRow
                  key={provider.pubkey}
                  provider={provider}
                  count={count}
                  onUse={() => {
                    setKey(nip19.npubEncode(provider.pubkey));
                    setRelay(provider.relay ?? '');
                    setKind(provider.kind);
                    setTag(provider.tag);
                  }}
                />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function toHex(value: string): string | null {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();

  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    // Not an identifier this app understands
  }

  return null;
}

function ProviderRow({
  provider,
  onRemove,
  busy,
}: {
  provider: TrustProvider;
  onRemove: () => void;
  busy: boolean;
}) {
  const author = useAuthor(provider.pubkey);
  const metadata = author.data?.metadata;
  const name =
    metadata?.name || metadata?.display_name || genUserName(provider.pubkey);

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          <Badge variant="secondary" className="text-[10px]">
            {provider.selector}
          </Badge>
          {provider.isPrivate && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <EyeOff className="h-3 w-3" />
              private
            </Badge>
          )}
        </div>
        {metadata?.about && (
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {metadata.about}
          </p>
        )}
        {provider.relay && (
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {provider.relay}
          </p>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        disabled={busy}
        aria-label={`Stop trusting ${name} for ${provider.selector}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

function DiscoveredRow({
  provider,
  count,
  onUse,
}: {
  provider: TrustProvider;
  count: number;
  onUse: () => void;
}) {
  const author = useAuthor(provider.pubkey);
  const metadata = author.data?.metadata;
  const name =
    metadata?.name || metadata?.display_name || genUserName(provider.pubkey);

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{name}</p>
        <p className="text-xs text-muted-foreground">
          {count === 1 ? '1 person you follow' : `${count} people you follow`} ·{' '}
          {provider.selector}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onUse}>
        Use
      </Button>
    </li>
  );
}

import { useState } from 'react';
import { useSeo } from '@/hooks/useSeo';
import {
  CloudDownload,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Upload,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { RelayRow } from '@/components/relays/RelayRow';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useRelays } from '@/hooks/useRelays';
import { useRelayHealth } from '@/hooks/useRelayHealth';
import { useRelayList } from '@/hooks/useRelayList';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { isValidRelayUrl, relayDisplayName } from '@/lib/relay';

export function RelaysPage() {
  useSeo({
    title: 'Relay settings',
    description:
      'Manage the Nostr relays this client reads from and publishes to, with live health checks, NIP-11 details and NIP-65 relay list publishing.',
    path: '/relays',
  });

  const {
    relays,
    primaryUrl,
    readUrls,
    writeUrls,
    suggestions,
    addRelay,
    removeRelay,
    toggleMode,
    setPrimary,
    replaceAll,
  } = useRelays();

  const { health, refresh } = useRelayHealth(relays.map((relay) => relay.url));
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const {
    entries: publishedEntries,
    isLoading: listLoading,
    publish,
    isPublishing,
  } = useRelayList();

  const [input, setInput] = useState('');

  const handleAdd = () => {
    const value = input.trim();
    if (!value) return;

    if (!isValidRelayUrl(value)) {
      toast({
        title: 'Invalid relay URL',
        description: 'Use a websocket address, for example wss://relay.damus.io',
        variant: 'destructive',
      });
      return;
    }

    if (!addRelay(value)) {
      toast({ title: 'Already in your list', variant: 'destructive' });
      return;
    }

    setInput('');
    toast({ title: 'Relay added', description: relayDisplayName(value) });
  };

  const onlineCount = relays.filter(
    (relay) => health[relay.url]?.status === 'online'
  ).length;

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Server}
          title="Relays"
          description="Notes are read from every relay you enable and published to the ones you mark as write."
          action={
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Re-check
            </Button>
          }
        />

        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Connected" value={`${onlineCount}/${relays.length}`} />
          <StatCard label="Reading from" value={readUrls.length} />
          <StatCard label="Publishing to" value={writeUrls.length} />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add a relay</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder="wss://relay.example.com"
                aria-label="Relay websocket URL"
                className="font-mono text-sm"
              />
              <Button onClick={handleAdd} disabled={!input.trim()}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add
              </Button>
            </div>

            {suggestions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Suggestions</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.slice(0, 10).map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => addRelay(preset.url)}
                      className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      + {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Your relays
              <Badge variant="secondary" className="ml-2">
                {relays.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y border-t">
              {relays.map((relay) => (
                <RelayRow
                  key={relay.url}
                  relay={relay}
                  health={health[relay.url]}
                  isPrimary={relay.url === primaryUrl}
                  canRemove={relays.length > 1}
                  onToggleMode={(mode, value) =>
                    toggleMode(relay.url, mode, value)
                  }
                  onSetPrimary={() => setPrimary(relay.url)}
                  onRemove={() => {
                    if (removeRelay(relay.url)) {
                      toast({ title: 'Relay removed' });
                    }
                  }}
                />
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* NIP-65 sync */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Published relay list</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              NIP-65 lets other clients discover where to find your notes. Your
              list is a public, replaceable event (kind 10002).
            </p>

            {!user ? (
              <p className="text-sm text-muted-foreground">
                Log in to publish or import a relay list.
              </p>
            ) : (
              <>
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  {listLoading ? (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Looking for your published list…
                    </span>
                  ) : publishedEntries.length === 0 ? (
                    <span className="text-muted-foreground">
                      You haven't published a relay list yet.
                    </span>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Currently published
                      </p>
                      <ul className="space-y-1">
                        {publishedEntries.map((entry) => (
                          <li
                            key={entry.url}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="truncate font-mono text-xs">
                              {relayDisplayName(entry.url)}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {entry.read && entry.write
                                ? 'read/write'
                                : entry.read
                                  ? 'read'
                                  : 'write'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <Separator />

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => publish(relays)}
                    disabled={isPublishing}
                    className="bg-brand-gradient"
                  >
                    {isPublishing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    Publish this list
                  </Button>

                  <Button
                    variant="outline"
                    disabled={publishedEntries.length === 0}
                    onClick={() => {
                      replaceAll(publishedEntries);
                      toast({
                        title: 'Imported',
                        description: `Now using ${publishedEntries.length} relays from your published list.`,
                      });
                    }}
                  >
                    <CloudDownload className="mr-2 h-4 w-4" />
                    Import published list
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-3 text-center sm:p-4">
        <p className="text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

export default RelaysPage;

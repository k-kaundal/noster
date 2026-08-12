import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Ban, ShieldCheck, ShieldQuestion, Trash2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useAllowedKinds,
  useAllowedPubkeys,
  useBannedEvents,
  useBannedPubkeys,
  useBlockedIps,
  useEventsNeedingModeration,
  useRelayCommand,
  useRelayManagement,
} from '@/hooks/useRelayManagement';
import { isDestructive, type ManagementMethod } from '@/lib/nip86';
import { relayDisplayName } from '@/lib/relay';

interface PendingAction {
  method: ManagementMethod;
  params: unknown[];
  title: string;
  description: string;
}

/**
 * NIP-86 relay administration.
 *
 * Shown only when the relay answers `supportedmethods` for this key, and only
 * the sections it actually implements. A moderation panel offered to everyone
 * would be a wall of buttons that each fail with a 401 — which reads as the
 * app being broken rather than as the reader not being an administrator.
 */
export function RelayAdminPanel({ relayUrl }: { relayUrl: string }) {
  const { isAdmin, supports } = useRelayManagement(relayUrl);
  const { mutateAsync: run, isPending } = useRelayCommand(relayUrl);
  const [pending, setPending] = useState<PendingAction | null>(null);

  if (!isAdmin) return null;

  /**
   * Anything done to a person goes through a confirmation.
   *
   * Banning a key or blocking an address is outward-facing and takes effect
   * for everyone on the relay immediately. A misclick on a row is not a
   * reasonable way for that to happen, and the list is decided in `lib/nip86`
   * rather than here so a new destructive call cannot skip the check by being
   * written somewhere else.
   */
  const invoke = (action: PendingAction) => {
    if (isDestructive(action.method)) setPending(action);
    else void run({ method: action.method, params: action.params });
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <ShieldCheck className="h-4 w-4 text-primary" />
          </div>
          Administer {relayDisplayName(relayUrl)}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          This relay recognises your key as an administrator. Changes here take
          effect for everyone who uses it.
        </p>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="pubkeys">
          <TabsList>
            <TabsTrigger value="pubkeys">People</TabsTrigger>
            {supports('listeventsneedingmoderation') && (
              <TabsTrigger value="queue">Queue</TabsTrigger>
            )}
            {supports('listbannedevents') && (
              <TabsTrigger value="events">Events</TabsTrigger>
            )}
            {supports('listallowedkinds') && (
              <TabsTrigger value="kinds">Kinds</TabsTrigger>
            )}
            {supports('listblockedips') && (
              <TabsTrigger value="ips">Addresses</TabsTrigger>
            )}
            <TabsTrigger value="identity">Identity</TabsTrigger>
          </TabsList>

          <TabsContent value="pubkeys" className="space-y-4 pt-4">
            <PubkeySection relayUrl={relayUrl} onRun={invoke} busy={isPending} />
          </TabsContent>

          <TabsContent value="queue" className="space-y-3 pt-4">
            <ModerationQueue relayUrl={relayUrl} onRun={invoke} busy={isPending} />
          </TabsContent>

          <TabsContent value="events" className="space-y-3 pt-4">
            <BannedEvents relayUrl={relayUrl} onRun={invoke} busy={isPending} />
          </TabsContent>

          <TabsContent value="kinds" className="space-y-3 pt-4">
            <KindSection relayUrl={relayUrl} onRun={invoke} busy={isPending} />
          </TabsContent>

          <TabsContent value="ips" className="space-y-3 pt-4">
            <IpSection relayUrl={relayUrl} onRun={invoke} busy={isPending} />
          </TabsContent>

          <TabsContent value="identity" className="space-y-3 pt-4">
            <IdentitySection onRun={invoke} busy={isPending} />
          </TabsContent>
        </Tabs>
      </CardContent>

      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) {
                  void run({ method: pending.method, params: pending.params });
                }
                setPending(null);
              }}
            >
              Do it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

type Runner = (action: PendingAction) => void;

/** Turns an npub into hex, since the API takes hex and people copy npubs. */
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

function shortKey(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 10)}…`;
  }
}

function PubkeySection({
  relayUrl,
  onRun,
  busy,
}: {
  relayUrl: string;
  onRun: Runner;
  busy: boolean;
}) {
  const { supports } = useRelayManagement(relayUrl);
  const banned = useBannedPubkeys(relayUrl, supports('listbannedpubkeys'));
  const allowed = useAllowedPubkeys(relayUrl, supports('listallowedpubkeys'));

  const [key, setKey] = useState('');
  const [reason, setReason] = useState('');

  const hex = toHex(key);

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border p-3">
        <Label htmlFor="admin-pubkey">Key</Label>
        <Input
          id="admin-pubkey"
          value={key}
          onChange={(changed) => setKey(changed.target.value)}
          placeholder="npub1… or hex"
        />
        <Input
          value={reason}
          onChange={(changed) => setReason(changed.target.value)}
          placeholder="Reason (optional)"
        />

        {key.trim() && !hex && (
          <p className="text-xs text-destructive">
            That isn't a public key this app can read.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {supports('banpubkey') && (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || !hex}
              onClick={() =>
                onRun({
                  method: 'banpubkey',
                  params: reason.trim() ? [hex, reason.trim()] : [hex],
                  title: 'Ban this key?',
                  description: `${shortKey(hex!)} will not be able to publish to ${relayDisplayName(relayUrl)}, and this takes effect immediately for everyone.`,
                })
              }
            >
              <Ban className="mr-1.5 h-3.5 w-3.5" />
              Ban
            </Button>
          )}

          {supports('allowpubkey') && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !hex}
              onClick={() =>
                onRun({
                  method: 'allowpubkey',
                  params: reason.trim() ? [hex, reason.trim()] : [hex],
                  title: '',
                  description: '',
                })
              }
            >
              Allow
            </Button>
          )}
        </div>
      </div>

      <KeyList
        title="Banned"
        entries={banned.data ?? []}
        empty="Nobody is banned."
        action={
          supports('unbanpubkey')
            ? {
                label: 'Unban',
                run: (pubkey) =>
                  onRun({
                    method: 'unbanpubkey',
                    params: [pubkey],
                    title: '',
                    description: '',
                  }),
              }
            : undefined
        }
        busy={busy}
      />

      <KeyList
        title="Allowed"
        entries={allowed.data ?? []}
        empty="No allow list."
        action={
          supports('unallowpubkey')
            ? {
                label: 'Remove',
                run: (pubkey) =>
                  onRun({
                    method: 'unallowpubkey',
                    params: [pubkey],
                    title: 'Remove from the allow list?',
                    description: `On a relay that only accepts allowed keys, ${shortKey(pubkey)} will stop being able to publish.`,
                  }),
              }
            : undefined
        }
        busy={busy}
      />
    </div>
  );
}

function KeyList({
  title,
  entries,
  empty,
  action,
  busy,
}: {
  title: string;
  entries: { pubkey: string; reason?: string }[];
  empty: string;
  action?: { label: string; run: (pubkey: string) => void };
  busy: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry) => (
            <li
              key={entry.pubkey}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-xs">
                  {shortKey(entry.pubkey)}
                </p>
                {entry.reason && (
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.reason}
                  </p>
                )}
              </div>

              {action && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => action.run(entry.pubkey)}
                >
                  {action.label}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModerationQueue({
  relayUrl,
  onRun,
  busy,
}: {
  relayUrl: string;
  onRun: Runner;
  busy: boolean;
}) {
  const { supports } = useRelayManagement(relayUrl);
  const queue = useEventsNeedingModeration(
    relayUrl,
    supports('listeventsneedingmoderation')
  );

  const entries = queue.data ?? [];

  if (!entries.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldQuestion className="h-4 w-4" />
        Nothing waiting.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
        >
          <div className="min-w-0">
            <a
              href={`/${nip19.noteEncode(entry.id)}`}
              className="truncate font-mono text-xs text-primary hover:underline"
            >
              {entry.id.slice(0, 12)}…
            </a>
            {entry.reason && (
              <p className="truncate text-xs text-muted-foreground">
                {entry.reason}
              </p>
            )}
          </div>

          <div className="flex shrink-0 gap-1">
            {supports('allowevent') && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  onRun({
                    method: 'allowevent',
                    params: [entry.id],
                    title: '',
                    description: '',
                  })
                }
              >
                Allow
              </Button>
            )}
            {supports('banevent') && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  onRun({
                    method: 'banevent',
                    params: [entry.id],
                    title: 'Ban this event?',
                    description:
                      'The relay will stop serving it to anyone. This is not reversible from here.',
                  })
                }
              >
                Ban
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function BannedEvents({
  relayUrl,
  onRun,
  busy,
}: {
  relayUrl: string;
  onRun: Runner;
  busy: boolean;
}) {
  const { supports } = useRelayManagement(relayUrl);
  const banned = useBannedEvents(relayUrl, supports('listbannedevents'));
  const entries = banned.data ?? [];

  if (!entries.length) {
    return <p className="text-sm text-muted-foreground">No banned events.</p>;
  }

  return (
    <ul className="space-y-1">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate font-mono text-xs">{entry.id.slice(0, 16)}…</p>
            {entry.reason && (
              <p className="truncate text-xs text-muted-foreground">
                {entry.reason}
              </p>
            )}
          </div>

          {supports('allowevent') && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                onRun({
                  method: 'allowevent',
                  params: [entry.id],
                  title: '',
                  description: '',
                })
              }
            >
              Unban
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function KindSection({
  relayUrl,
  onRun,
  busy,
}: {
  relayUrl: string;
  onRun: Runner;
  busy: boolean;
}) {
  const { supports } = useRelayManagement(relayUrl);
  const kinds = useAllowedKinds(relayUrl, supports('listallowedkinds'));
  const [draft, setDraft] = useState('');

  const kind = Number.parseInt(draft.trim(), 10);
  const valid = Number.isInteger(kind) && kind >= 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(kinds.data ?? []).map((entry) => (
          <Badge key={entry} variant="secondary" className="gap-1">
            {entry}
            {supports('disallowkind') && (
              <button
                type="button"
                disabled={busy}
                aria-label={`Disallow kind ${entry}`}
                onClick={() =>
                  onRun({
                    method: 'disallowkind',
                    params: [entry],
                    title: `Stop accepting kind ${entry}?`,
                    description:
                      'The relay will reject new events of this kind from everyone.',
                  })
                }
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
        {(kinds.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            No explicit allow list — the relay decides for itself.
          </p>
        )}
      </div>

      {supports('allowkind') && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(changed) => setDraft(changed.target.value)}
            placeholder="Kind number"
            inputMode="numeric"
            className="max-w-40"
          />
          <Button
            size="sm"
            disabled={busy || !valid}
            onClick={() => {
              onRun({
                method: 'allowkind',
                params: [kind],
                title: '',
                description: '',
              });
              setDraft('');
            }}
          >
            Allow
          </Button>
        </div>
      )}
    </div>
  );
}

function IpSection({
  relayUrl,
  onRun,
  busy,
}: {
  relayUrl: string;
  onRun: Runner;
  busy: boolean;
}) {
  const { supports } = useRelayManagement(relayUrl);
  const blocked = useBlockedIps(relayUrl, supports('listblockedips'));
  const [ip, setIp] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Blocking an address affects everyone behind it — a household, an office,
        a whole mobile carrier. Bans by key are usually the narrower tool.
      </p>

      {supports('blockip') && (
        <div className="flex flex-wrap gap-2">
          <Input
            value={ip}
            onChange={(changed) => setIp(changed.target.value)}
            placeholder="203.0.113.4"
            className="max-w-48"
          />
          <Input
            value={reason}
            onChange={(changed) => setReason(changed.target.value)}
            placeholder="Reason (optional)"
            className="max-w-60"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || !ip.trim()}
            onClick={() =>
              onRun({
                method: 'blockip',
                params: reason.trim()
                  ? [ip.trim(), reason.trim()]
                  : [ip.trim()],
                title: 'Block this address?',
                description: `Everyone connecting from ${ip.trim()} will be refused, not only the account you have in mind.`,
              })
            }
          >
            Block
          </Button>
        </div>
      )}

      <ul className="space-y-1">
        {(blocked.data ?? []).map((entry) => (
          <li
            key={entry.ip}
            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-xs">{entry.ip}</p>
              {entry.reason && (
                <p className="truncate text-xs text-muted-foreground">
                  {entry.reason}
                </p>
              )}
            </div>

            {supports('unblockip') && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  onRun({
                    method: 'unblockip',
                    params: [entry.ip],
                    title: '',
                    description: '',
                  })
                }
              >
                Unblock
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function IdentitySection({ onRun, busy }: { onRun: Runner; busy: boolean }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');

  const field = (
    id: string,
    label: string,
    value: string,
    set: (value: string) => void,
    method: ManagementMethod
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(c) => set(c.target.value)} />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !value.trim()}
          onClick={() => {
            onRun({ method, params: [value.trim()], title: '', description: '' });
            set('');
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {field('relay-name', 'Name', name, setName, 'changerelayname')}
      {field(
        'relay-description',
        'Description',
        description,
        setDescription,
        'changerelaydescription'
      )}
      {field('relay-icon', 'Icon URL', icon, setIcon, 'changerelayicon')}
    </div>
  );
}

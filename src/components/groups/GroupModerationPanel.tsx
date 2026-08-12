import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Check, Copy, Loader2, Shield, Ticket, UserMinus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/useToast';
import { useGroupModeration } from '@/hooks/useGroupModeration';
import type { GroupAdmin, GroupMetadata, GroupRole } from '@/lib/nip29';

/**
 * Reads whatever a person pasted as a pubkey.
 *
 * An admin adding somebody has an `npub` in their clipboard far more often
 * than 64 hex characters, and refusing the form they actually have is a
 * pointless obstacle.
 */
function readPubkey(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();

  try {
    const decoded = nip19.decode(value.replace(/^nostr:/, ''));

    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    // Not an identifier we know; the caller says so
  }

  return null;
}

/**
 * Admin controls for a group.
 *
 * Shown to anyone the relay's own kind:39001 lists with a role, since the spec
 * says users "with any roles that have any privilege can be considered admins
 * in a broad sense". What each role may actually do is relay policy that this
 * cannot know, so every action is offered and the relay's refusal is shown
 * verbatim when one comes back — better than hiding a button the relay would
 * have honoured.
 */
export function GroupModerationPanel({
  relayUrl,
  group,
  admins,
  roles,
}: {
  relayUrl: string;
  group: GroupMetadata;
  admins: GroupAdmin[];
  roles: GroupRole[];
}) {
  const { toast } = useToast();
  const moderation = useGroupModeration(relayUrl, group, admins);

  const [target, setTarget] = useState('');
  const [role, setRole] = useState('');
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!moderation.canModerate) return null;

  const act = async (action: 'add' | 'remove') => {
    const pubkey = readPubkey(target);

    if (!pubkey) {
      toast({
        title: "That isn't a pubkey",
        description: 'Paste an npub, an nprofile, or 64 hex characters.',
        variant: 'destructive',
      });
      return;
    }

    if (action === 'add') {
      await moderation
        .putUser({
          pubkey,
          roles: role.trim() ? [role.trim()] : [],
        })
        .catch(() => {});
    } else {
      await moderation.removeUser({ pubkey }).catch(() => {});
    }

    setTarget('');
  };

  const copyInvite = async () => {
    if (!invite) return;

    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Could not copy', description: invite });
    }
  };

  return (
    <Card>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 p-4 text-left text-sm font-medium"
          >
            <Shield className="h-4 w-4 text-muted-foreground" />
            Moderation
            <span className="ml-auto flex flex-wrap gap-1">
              {moderation.roles.map((name) => (
                <Badge key={name} variant="secondary" className="text-xs">
                  {name}
                </Badge>
              ))}
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-4 border-t pt-4">
            <div className="space-y-2">
              <Label htmlFor="mod-target" className="text-sm">
                Member
              </Label>
              <Input
                id="mod-target"
                value={target}
                onChange={(changed) => setTarget(changed.target.value)}
                placeholder="npub1…"
              />

              {/*
                Role names come from the relay's own kind:39003 when it
                publishes one. Typed freely otherwise — the spec lets a relay
                accept arbitrary names and simply ignore the ones it does not
                use, so a fixed list here would be this client's guess rather
                than the relay's policy.
              */}
              <Input
                value={role}
                onChange={(changed) => setRole(changed.target.value)}
                placeholder={
                  roles.length
                    ? `Role (${roles.map((entry) => entry.name).join(', ')})`
                    : 'Role (optional)'
                }
              />

              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 gap-1.5"
                  disabled={moderation.isWorking}
                  onClick={() => act('add')}
                >
                  {moderation.isWorking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="h-3.5 w-3.5" />
                  )}
                  Add or set role
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 gap-1.5"
                  disabled={moderation.isWorking}
                  onClick={() => act('remove')}
                >
                  <UserMinus className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            </div>

            <div className="space-y-2 border-t pt-4">
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                disabled={moderation.isWorking}
                onClick={async () => {
                  const code = await moderation.createInvite(undefined).catch(() => null);
                  if (code) setInvite(code);
                }}
              >
                <Ticket className="h-3.5 w-3.5" />
                Create an invite code
              </Button>

              {invite && (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
                  <code className="min-w-0 flex-1 truncate text-xs">
                    {invite}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 gap-1.5"
                    onClick={copyInvite}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-success-strong" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              )}

              {invite && (
                <p className="text-xs text-muted-foreground">
                  Append it to the group's address as{' '}
                  <code>?invite={invite.slice(0, 8)}…</code> so a client can
                  send it with the join request.
                </p>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Lock,
  Radio,
  Send,
  Server,
  Users,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoginArea } from '@/components/auth/LoginArea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSeo } from '@/hooks/useSeo';
import { useAccountStored } from '@/hooks/useStore';
import {
  useGroup,
  useGroupMembership,
  useGroupMessages,
  useGroupRelaySupport,
  useGroups,
} from '@/hooks/useGroups';
import { GROUP_CHAT, acceptsKind, type GroupNode } from '@/lib/nip29';
import { genUserName } from '@/lib/genUserName';
import { relativeTime } from '@/lib/time';

/**
 * Relays known to run NIP-29, offered because there is no discovering them.
 *
 * A group only exists where a relay enforces it, and an ordinary relay
 * returns nothing at all — which reads as a broken page rather than as the
 * wrong address. Somewhere to start beats an empty box.
 */
const SUGGESTED = [
  'wss://groups.0xchat.com',
  'wss://relay.groups.nip29.com',
];

export function GroupsPage() {
  useSeo({
    title: 'Groups',
    description: 'Relay-hosted groups on Nostr.',
    path: '/groups',
  });

  const [params, setParams] = useSearchParams();
  const groupId = params.get('id') || undefined;

  const [relayUrl, setRelayUrl] = useAccountStored<string>(
    'nip29:relay',
    SUGGESTED[0]
  );

  return (
    <Layout>
      <PageHeader
        title="Groups"
        description="Groups hosted by a relay, which decides who may join and post."
      />

      <div className="space-y-4">
        <RelayPicker value={relayUrl} onChange={setRelayUrl} />

        {groupId ? (
          <GroupView
            relayUrl={relayUrl}
            groupId={groupId}
            onBack={() => setParams({})}
          />
        ) : (
          <GroupList
            relayUrl={relayUrl}
            onOpen={(id) => setParams({ id })}
          />
        )}
      </div>
    </Layout>
  );
}

function RelayPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const { supported, isLoading, info } = useGroupRelaySupport(value);

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onChange(draft.trim());
            }}
            placeholder="wss://groups.example.com"
            aria-label="Groups relay"
          />
          <Button
            variant="outline"
            onClick={() => onChange(draft.trim())}
            disabled={!draft.trim() || draft.trim() === value}
          >
            Use
          </Button>
        </div>

        {/* Said plainly, because an unsupported relay looks identical to a
            relay with no groups on it */}
        {isLoading ? (
          <Skeleton className="h-3 w-40" />
        ) : supported ? (
          <p className="text-xs text-success">
            {info?.name ?? value} hosts groups.
          </p>
        ) : (
          <p className="text-xs text-warning-foreground">
            This relay doesn't advertise NIP-29, so it probably hosts no
            groups. Groups need a relay that enforces them — there is no way to
            run one from the browser.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED.map((url) => (
            <Button
              key={url}
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setDraft(url);
                onChange(url);
              }}
            >
              {url.replace('wss://', '')}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function GroupList({
  relayUrl,
  onOpen,
}: {
  relayUrl: string;
  onOpen: (id: string) => void;
}) {
  const { tree, isLoading } = useGroups(relayUrl);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!tree.length) {
    return (
      <EmptyState
        icon={Users}
        title="No groups here"
        description="This relay isn't serving any groups. Try another one."
      />
    );
  }

  return (
    <div className="space-y-2">
      {tree.map((node) => (
        <GroupRow key={node.id} node={node} onOpen={onOpen} />
      ))}
    </div>
  );
}

function GroupRow({
  node,
  onOpen,
  depth = 0,
}: {
  node: GroupNode;
  onOpen: (id: string) => void;
  depth?: number;
}) {
  return (
    <>
      <Card
        className="cursor-pointer transition-colors hover:bg-accent/40"
        style={{ marginLeft: depth * 16 }}
        onClick={() => onOpen(node.id)}
      >
        <CardContent className="flex items-center gap-3 py-3">
          <Avatar className="h-9 w-9">
            <AvatarImage src={node.picture} alt="" />
            <AvatarFallback>{node.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{node.name}</p>
            {node.about && (
              <p className="truncate text-xs text-muted-foreground">
                {node.about}
              </p>
            )}
          </div>

          <div className="flex shrink-0 gap-1">
            {node.isPrivate && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Lock className="h-3 w-3" />
                Private
              </Badge>
            )}
            {node.hasLivekit && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Radio className="h-3 w-3" />
                Live
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {node.subgroups.map((child) => (
        <GroupRow
          key={child.id}
          node={child}
          onOpen={onOpen}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

function GroupView({
  relayUrl,
  groupId,
  onBack,
}: {
  relayUrl: string;
  groupId: string;
  onBack: () => void;
}) {
  const { user } = useCurrentUser();
  const { group, admins, isLoading } = useGroup(relayUrl, groupId);
  const { messages } = useGroupMessages(relayUrl, groupId);
  const membership = useGroupMembership(relayUrl, groupId);

  const [draft, setDraft] = useState('');

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;

  if (!group) {
    return (
      <EmptyState
        icon={Users}
        title="Group not found"
        description="This relay has no group with that id."
        action={<Button onClick={onBack}>Back to groups</Button>}
      />
    );
  }

  const canWrite =
    acceptsKind(group, GROUP_CHAT) &&
    (!group.isRestricted || membership.isMember);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;

    // The last messages become the `previous` references proving this was
    // written in context rather than replayed from a fork elsewhere
    await membership.post({ content, seen: messages }).catch(() => {});
    setDraft('');
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        <ArrowLeft className="h-4 w-4" />
        All groups
      </Button>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={group.picture} alt="" />
              <AvatarFallback>
                {group.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold">{group.name}</h2>
              {group.about && (
                <p className="text-sm text-muted-foreground">{group.about}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {admins.length} admin{admins.length === 1 ? '' : 's'} ·{' '}
                {relayUrl.replace('wss://', '')}
              </p>
            </div>

            {user && (
              <Button
                size="sm"
                variant={membership.isMember ? 'outline' : 'default'}
                disabled={membership.isJoining || membership.isLeaving}
                onClick={() =>
                  membership.isMember
                    ? void membership.leave().catch(() => {})
                    : void membership.join(undefined).catch(() => {})
                }
              >
                {membership.isMember ? 'Leave' : 'Join'}
              </Button>
            )}
          </div>

          {group.isClosed && !membership.isMember && (
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              This group is closed — join requests are only accepted with an
              invite code.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {group.isPrivate && !membership.isMember
                ? 'This group is private, so only members can read it.'
                : 'Nothing has been said here yet.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {messages.map((message) => (
                <Message key={message.id} event={message} />
              ))}
            </ul>
          )}

          {!user ? (
            <LoginArea className="mx-auto max-w-60" />
          ) : canWrite ? (
            <div className="flex gap-2">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Say something"
                className="min-h-[44px] resize-none"
              />
              <Button
                onClick={() => void send()}
                disabled={!draft.trim() || membership.isPosting}
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              {!acceptsKind(group, GROUP_CHAT)
                ? 'This group does not take text messages.'
                : 'Only members can post here.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Message({ event }: { event: { id: string; pubkey: string; content: string; created_at: number } }) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.name || genUserName(event.pubkey);

  return (
    <li className="flex gap-2">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-[10px]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          <Link to={`/${event.pubkey}`} className="font-medium text-foreground hover:underline">
            {name}
          </Link>{' '}
          · {relativeTime(event.created_at * 1000)}
        </p>
        <p className="whitespace-pre-wrap break-words text-sm">
          {event.content}
        </p>
      </div>
    </li>
  );
}

export default GroupsPage;

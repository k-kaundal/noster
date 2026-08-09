import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import {
  Hash,
  Loader2,
  MessagesSquare,
  Plus,
  Settings,
  Type,
  Upload,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { AccentPicker } from '@/components/AccentPicker';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LoginArea } from '@/components/auth/LoginArea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMuteList } from '@/hooks/useMuteList';
import { useDmRelayList } from '@/hooks/useDmRelayList';
import { useRelays } from '@/hooks/useRelays';
import { useSeo } from '@/hooks/useSeo';
import { genUserName } from '@/lib/genUserName';
import { relayDisplayName } from '@/lib/relay';
import { getMuteValue } from '@/lib/mute';

export function SettingsPage() {
  useSeo({
    title: 'Settings',
    description: 'Appearance, muted content and private message relays.',
    path: '/settings',
    noindex: true,
  });

  const { user } = useCurrentUser();

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Settings}
          title="Settings"
          description="Appearance lives on this device. Mutes and message relays are published to your account, so they follow you between clients."
        />

        <Tabs defaultValue="appearance" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="appearance" className="flex-1 sm:flex-none">
              Appearance
            </TabsTrigger>
            <TabsTrigger value="muted" className="flex-1 sm:flex-none">
              Muted
            </TabsTrigger>
            <TabsTrigger value="messages" className="flex-1 sm:flex-none">
              Messages
            </TabsTrigger>
            <TabsTrigger value="wallet" className="flex-1 sm:flex-none">
              Wallet
            </TabsTrigger>
          </TabsList>

          <TabsContent value="appearance">
            <AppearanceSettings />
          </TabsContent>
          <TabsContent value="muted">
            {user ? <MuteSettings /> : <SignedOutNotice what="mute list" />}
          </TabsContent>
          <TabsContent value="messages">
            {user ? (
              <MessageRelaySettings />
            ) : (
              <SignedOutNotice what="message relays" />
            )}
          </TabsContent>
          <TabsContent value="wallet">
            <WalletPointer />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

/**
 * The wallet has its own page now.
 *
 * Left as a signpost rather than removed: the tab is where people learned to
 * look for it, and a tab that quietly disappears reads as a feature that was
 * taken away.
 */
function WalletPointer() {
  return (
    <EmptyState
      icon={Wallet}
      title="Your wallet has its own page"
      description="Balance, sending, receiving and your lightning address all live there now."
      action={
        <Button asChild>
          <Link to="/wallet">Open my wallet</Link>
        </Button>
      }
    />
  );
}

function SignedOutNotice({ what }: { what: string }) {
  return (
    <EmptyState
      icon={Settings}
      title={`Log in to manage your ${what}`}
      description="This setting is published to your Nostr account rather than saved here, so it follows you to any other client."
      action={<LoginArea className="mx-auto max-w-60" />}
    />
  );
}

function AppearanceSettings() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Appearance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Accent colour</p>
            <p className="text-xs text-muted-foreground">
              Every other colour is derived from your choice.
            </p>
          </div>
          <AccentPicker />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Light or dark</p>
            <p className="text-xs text-muted-foreground">
              Following the system switches with your OS.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </CardContent>
    </Card>
  );
}

function MuteSettings() {
  const {
    list,
    isLoading,
    isUpdating,
    unmuteUser,
    muteWord,
    unmuteWord,
    muteHashtag,
    unmuteHashtag,
  } = useMuteList();

  const [word, setWord] = useState('');
  const [hashtag, setHashtag] = useState('');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <VolumeX className="h-4 w-4" />
            Muted people
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="px-6 pb-4 text-sm text-muted-foreground">Loading…</p>
          ) : list.pubkeys.length === 0 ? (
            <p className="px-6 pb-4 text-sm text-muted-foreground">
              Nobody muted. Use the menu on any note to mute its author.
            </p>
          ) : (
            <ul className="divide-y border-t">
              {list.pubkeys.map((item) => {
                const pubkey = getMuteValue(item);
                return (
                  <MutedPersonRow
                    key={pubkey}
                    pubkey={pubkey}
                    onUnmute={() => unmuteUser(pubkey)}
                    disabled={isUpdating}
                  />
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <TokenListCard
        icon={Type}
        title="Muted words"
        description="Notes containing these words are hidden. Whole words only, so muting “art” won’t hide “start”."
        placeholder="Add a word"
        value={word}
        onValueChange={setWord}
        onAdd={async () => {
          await muteWord(word);
          setWord('');
        }}
        items={list.words.map(getMuteValue)}
        onRemove={unmuteWord}
        disabled={isUpdating}
      />

      <TokenListCard
        icon={Hash}
        title="Muted hashtags"
        description="Hides notes tagged with these, whether the tag is indexed or written inline."
        placeholder="bitcoin"
        value={hashtag}
        onValueChange={setHashtag}
        onAdd={async () => {
          await muteHashtag(hashtag);
          setHashtag('');
        }}
        items={list.hashtags.map(getMuteValue)}
        onRemove={unmuteHashtag}
        disabled={isUpdating}
        prefix="#"
      />
    </div>
  );
}

function MutedPersonRow({
  pubkey,
  onUnmute,
  disabled,
}: {
  pubkey: string;
  onUnmute: () => void;
  disabled: boolean;
}) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(pubkey);

  return (
    <li className="flex items-center gap-3 p-3">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-xs">
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <Link
        to={`/${nip19.npubEncode(pubkey)}`}
        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
      >
        {displayName}
      </Link>

      <Button variant="outline" size="sm" onClick={onUnmute} disabled={disabled}>
        Unmute
      </Button>
    </li>
  );
}

function TokenListCard({
  icon: Icon,
  title,
  description,
  placeholder,
  value,
  onValueChange,
  onAdd,
  items,
  onRemove,
  disabled,
  prefix = '',
}: {
  icon: typeof Hash;
  title: string;
  description: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  onAdd: () => void;
  items: string[];
  onRemove: (item: string) => void;
  disabled: boolean;
  prefix?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{description}</p>

        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAdd();
              }
            }}
            placeholder={placeholder}
            aria-label={title}
          />
          <Button onClick={onAdd} disabled={!value.trim() || disabled}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add
          </Button>
        </div>

        {items.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 text-xs"
              >
                {prefix}
                {item}
                <button
                  type="button"
                  onClick={() => onRemove(item)}
                  disabled={disabled}
                  aria-label={`Unmute ${item}`}
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MessageRelaySettings() {
  const { relays: published, isLoading, publish, isPublishing } = useDmRelayList();
  const { relays: configured } = useRelays();
  const [selected, setSelected] = useState<string[] | null>(null);

  // Start from what is already published, falling back to the read relays
  const current =
    selected ??
    (published.length
      ? published
      : configured.filter((relay) => relay.read).map((relay) => relay.url));

  const toggle = (url: string) => {
    setSelected(
      current.includes(url)
        ? current.filter((entry) => entry !== url)
        : [...current, url]
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessagesSquare className="h-4 w-4" />
          Private message relays
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          NIP-17 requires senders to deliver private messages only to the relays
          you nominate here. Until you publish a list, other clients have
          nowhere to send them and your messages may never arrive.
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {published.length === 0 && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                You haven't published a message relay list yet.
              </p>
            )}

            <ul className="space-y-2">
              {configured.map((relay) => (
                <li
                  key={relay.url}
                  className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
                >
                  <Label
                    htmlFor={`dm-${relay.url}`}
                    className="min-w-0 flex-1 cursor-pointer truncate text-sm font-normal"
                  >
                    {relayDisplayName(relay.url)}
                  </Label>
                  <Switch
                    id={`dm-${relay.url}`}
                    checked={current.includes(relay.url)}
                    onCheckedChange={() => toggle(relay.url)}
                  />
                </li>
              ))}
            </ul>

            <Button
              onClick={() => publish(current)}
              disabled={isPublishing || current.length === 0}
              className=""
            >
              {isPublishing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Publish message relays
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default SettingsPage;

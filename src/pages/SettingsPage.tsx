import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Badge } from '@/components/ui/badge';
import {
  Globe,
  Hash,
  Loader2,
  Lock,
  MessagesSquare,
  Plus,
  Sparkles,
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
import { useMutePrivacy } from '@/hooks/useMutePrivacy';
import { useAdultContent } from '@/hooks/useAdultContent';
import { useMachineEvents } from '@/hooks/useMachineEvents';
import { TrustProviderSettings } from '@/components/trust/TrustProviderSettings';
import { useDmRelayList } from '@/hooks/useDmRelayList';
import { useRelays } from '@/hooks/useRelays';
import { useSeo } from '@/hooks/useSeo';
import { AdvancedThemeSwitcher } from '@/components/AdvancedThemeSwitcher';
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
            <TabsTrigger value="ui" className="flex-1 sm:flex-none">
              UI
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
            <ContentSettings />
            <TrustProviderSettings />
          </TabsContent>
          <TabsContent value="ui">
            <UISettings />
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

/**
 * What the feed is allowed to show without being asked.
 *
 * Lives beside appearance rather than inside the advanced filters, because
 * those are opt-in as a group: a filter that only applies once someone has
 * opened a settings panel is no protection for the people most likely never
 * to open one.
 */
function ContentSettings() {
  const { showAdult, setShowAdult } = useAdultContent();
  const { showMachine, setShowMachine } = useMachineEvents();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Content</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Adult content</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Off by default. Posts that label themselves as adult — a NIP-36
              warning, or tags like #nsfw — are kept out of your feed. Nothing
              unlabelled is guessed at, so this depends on posters marking
              their own work.
            </p>
          </div>
          <Switch
            checked={showAdult}
            onCheckedChange={setShowAdult}
            aria-label="Show adult content"
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Machine posts</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Services and devices publish status as ordinary notes — presence
              beacons, build results, sensor readings. One of them can post
              every few seconds, so they are kept out of the shared timeline.
              Their own profiles always show them.
            </p>
          </div>
          <Switch
            checked={showMachine}
            onCheckedChange={setShowMachine}
            aria-label="Show machine posts in the timeline"
          />
        </div>

        <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          This filters what arrives, whichever relay it came from. Which relays
          you read is a separate choice — the suggested ones on the relays page
          are the moderated ones.
        </p>
      </CardContent>
    </Card>
  );
}

function MuteSettings() {
  const {
    list,
    isLoading,
    isUpdating,
    canBePrivate,
    isPrivatelyMuted,
    unmuteUser,
    muteWord,
    unmuteWord,
    muteHashtag,
    unmuteHashtag,
  } = useMuteList();

  const { isPrivate, setPrivate } = useMutePrivacy();

  const [word, setWord] = useState('');
  const [hashtag, setHashtag] = useState('');

  // Only ever private when the signer can actually encrypt
  const visibility = { private: isPrivate && canBePrivate };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-start justify-between gap-4 py-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Keep new mutes private</p>
            <p className="text-sm text-muted-foreground">
              {canBePrivate
                ? 'Encrypted so only you can read them. A public mute list tells everyone who you have blocked.'
                : 'Your signer cannot encrypt, so mutes are published in the open where anyone can read them.'}
            </p>
          </div>
          <Switch
            checked={isPrivate && canBePrivate}
            disabled={!canBePrivate}
            onCheckedChange={setPrivate}
          />
        </CardContent>
      </Card>
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
                    isPrivate={isPrivatelyMuted(pubkey)}
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
          await muteWord(word, visibility);
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
          await muteHashtag(hashtag, visibility);
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
  isPrivate,
  onUnmute,
  disabled,
}: {
  pubkey: string;
  isPrivate: boolean;
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

      {/*
        Which half this entry lives in. Worth stating: the difference is
        whether the person being muted can find out.
      */}
      <Badge variant="secondary" className="shrink-0 gap-1 text-xs">
        {isPrivate ? (
          <>
            <Lock className="h-3 w-3" />
            Private
          </>
        ) : (
          <>
            <Globe className="h-3 w-3" />
            Public
          </>
        )}
      </Badge>

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

function UISettings() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Interface Enhancements
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Advanced Themes
            </p>
            <p className="text-xs text-muted-foreground">
              Choose from 13+ professional and creative theme presets, including X-inspired, premium corporate, and crypto-themed options.
            </p>
            <AdvancedThemeSwitcher />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SettingsPage;

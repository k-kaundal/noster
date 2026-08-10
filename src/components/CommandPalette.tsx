import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import {
  ArrowRight,
  Hash,
  Moon,
  PenSquare,
  Search,
  Sun,
  UserPlus,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useTheme } from '@/hooks/useTheme';
import { getNavItems } from '@/components/layout/navigation';
import { genUserName } from '@/lib/genUserName';
import type { AuthorData } from '@/hooks/useAuthor';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hands the typed text to the relay search, for anything not found here. */
  onSearchNostr: (query: string) => void;
}

interface Person {
  pubkey: string;
  name: string;
  nip05?: string;
  picture?: string;
  follows: boolean;
}

/** A pasted NIP-19 identifier, which can be opened without searching at all. */
function asNip19(query: string): string | null {
  const value = query.trim().replace(/^nostr:/, '');
  if (!/^(npub1|note1|nevent1|nprofile1|naddr1)/.test(value)) return null;

  try {
    nip19.decode(value);
    return value;
  } catch {
    return null;
  }
}

/**
 * Everywhere you can go and everyone you know, on one keystroke.
 *
 * Deliberately built from what is already in memory. A palette that waits on a
 * relay is a search box with extra steps — the value of this one is that it
 * answers between keystrokes, so the profiles come from the query cache and
 * the destinations from the same list that builds the navigation. Anything it
 * cannot answer is handed to the relay search, which can.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onSearchNostr,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { followingList } = useFollows(user?.pubkey || '');
  const { theme, setTheme } = useTheme();

  const [query, setQuery] = useState('');

  const identifier = useMemo(() => asNip19(query), [query]);
  const trimmed = query.trim();
  const hashtag = trimmed.startsWith('#') ? trimmed.slice(1) : null;

  const destinations = useMemo(
    () =>
      getNavItems(user?.pubkey).filter((item) => !item.requiresAuth || user),
    [user]
  );

  /**
   * People the app has already loaded.
   *
   * Read from the cache when the palette opens rather than fetched: these are
   * the people whose posts have been on screen and whose profiles are
   * therefore already here. Fetching hundreds of profiles to populate a
   * launcher would cost more than the launcher saves.
   */
  const people = useMemo(() => {
    if (!open) return [];

    const following = new Set(
      followingList.map((follow: { pubkey: string }) => follow.pubkey)
    );

    const cached = queryClient.getQueriesData<AuthorData>({
      queryKey: ['author'],
    });

    const seen = new Map<string, Person>();

    for (const [key, data] of cached) {
      const pubkey = key[1];
      if (typeof pubkey !== 'string' || pubkey.length !== 64) continue;
      if (seen.has(pubkey)) continue;

      const metadata = data?.metadata;

      seen.set(pubkey, {
        pubkey,
        name:
          metadata?.display_name || metadata?.name || genUserName(pubkey),
        nip05: metadata?.nip05,
        picture: metadata?.picture,
        follows: following.has(pubkey),
      });
    }

    // People you follow first: a launcher is for the people you reach for
    return [...seen.values()].sort((a, b) => {
      if (a.follows !== b.follows) return a.follows ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [open, queryClient, followingList]);

  const close = () => {
    onOpenChange(false);
    setQuery('');
  };

  const go = (path: string) => {
    navigate(path);
    close();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Go to a page, find someone, or paste an npub…"
        value={query}
        onValueChange={setQuery}
      />

      <CommandList>
        <CommandEmpty>
          Nothing here matches. Press enter to search Nostr for it.
        </CommandEmpty>

        {identifier && (
          <CommandGroup heading="Open">
            <CommandItem
              value={`open-${identifier}`}
              onSelect={() => go(`/${identifier}`)}
            >
              <ArrowRight className="mr-2 h-4 w-4" />
              <span className="truncate font-mono text-xs">{identifier}</span>
            </CommandItem>
          </CommandGroup>
        )}

        {hashtag && (
          <CommandGroup heading="Hashtag">
            <CommandItem
              value={`tag-${hashtag}`}
              onSelect={() => go(`/t/${encodeURIComponent(hashtag.toLowerCase())}`)}
            >
              <Hash className="mr-2 h-4 w-4" />
              #{hashtag}
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Go to">
          {destinations.map((item) => (
            <CommandItem
              key={item.href}
              value={`${item.label} ${item.href}`}
              onSelect={() => go(item.href)}
            >
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
              {item.shortcut && (
                <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {item.shortcut}
                </kbd>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        {people.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="People">
              {people.slice(0, 60).map((person) => (
                <CommandItem
                  key={person.pubkey}
                  value={`${person.name} ${person.nip05 ?? ''} ${person.pubkey}`}
                  onSelect={() => go(`/${nip19.npubEncode(person.pubkey)}`)}
                >
                  <Avatar className="mr-2 h-5 w-5">
                    <AvatarImage src={person.picture} alt="" />
                    <AvatarFallback className="text-[10px]">
                      {person.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{person.name}</span>
                  {person.follows && (
                    <UserPlus className="ml-2 h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem value="compose write note" onSelect={() => go('/compose')}>
            <PenSquare className="mr-2 h-4 w-4" />
            Write a note
          </CommandItem>

          <CommandItem
            value="theme dark light appearance"
            onSelect={() => {
              setTheme(theme === 'dark' ? 'light' : 'dark');
              close();
            }}
          >
            {theme === 'dark' ? (
              <Sun className="mr-2 h-4 w-4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" />
            )}
            Switch to {theme === 'dark' ? 'light' : 'dark'} mode
          </CommandItem>

          {/* The way out of a local launcher and into the network */}
          <CommandItem
            value="search nostr relays"
            onSelect={() => {
              onSearchNostr(trimmed);
              close();
            }}
          >
            <Search className="mr-2 h-4 w-4" />
            {trimmed ? `Search Nostr for "${trimmed}"` : 'Search Nostr'}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export default CommandPalette;

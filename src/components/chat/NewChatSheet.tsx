import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { NSchema as n } from '@nostrify/nostrify';
import { PenSquare, Search } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useAuthors } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDebounce } from '@/hooks/useDebounce';
import { useFollows } from '@/hooks/useFollows';
import { useSearch } from '@/hooks/useSearch';
import { genUserName } from '@/lib/genUserName';

interface Candidate {
  pubkey: string;
  name: string;
  picture?: string;
  nip05?: string;
}

/**
 * Starting a conversation from the messages screen.
 *
 * It could only be started from somebody's profile before, which is fine on a
 * desktop with two tabs open and hopeless on a phone: "message Alice" meant
 * leaving messages, finding Alice, and coming back. The people somebody
 * messages are overwhelmingly people they already follow, so those are the
 * list — searchable instantly, offline, with no relay round trip — and the
 * relay search is there for everybody else.
 */
export function NewChatSheet() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <PenSquare className="h-4 w-4" />
          New message
        </Button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className="flex h-[85dvh] flex-col gap-0 p-0 sm:h-[70dvh]"
      >
        <SheetHeader className="border-b p-4 text-left">
          <SheetTitle>New message</SheetTitle>
        </SheetHeader>

        {open && <PeoplePicker onPick={() => setOpen(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function PeoplePicker({ onPick }: { onPick: () => void }) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [query, setQuery] = useState('');

  const { followingList, isLoading: loadingFollows } = useFollows(
    user?.pubkey ?? ''
  );

  const followedKeys = useMemo(
    () => followingList.map((entry) => entry.pubkey),
    [followingList]
  );

  const followed = useAuthors(followedKeys, followedKeys.length > 0);

  const metadataFor = useMemo(() => {
    const byPubkey = new Map(
      followed.map((entry) => [entry.pubkey, entry.metadata])
    );
    return (pubkey: string) => byPubkey.get(pubkey);
  }, [followed]);

  /*
   * The relay is only asked once typing has settled and there is enough to
   * search on. Two characters match half of Nostr and cost a round trip to
   * say so.
   */
  const debounced = useDebounce(query.trim(), 300);
  const searchable = debounced.length >= 3;
  const { data: results, isFetching } = useSearch(searchable ? debounced : '');

  const term = query.trim().toLowerCase();

  const matches = useMemo<Candidate[]>(() => {
    const seen = new Set<string>();
    const list: Candidate[] = [];

    const add = (candidate: Candidate) => {
      if (candidate.pubkey === user?.pubkey) return;
      if (seen.has(candidate.pubkey)) return;
      seen.add(candidate.pubkey);
      list.push(candidate);
    };

    // People you follow first, always — they are who this is for
    for (const pubkey of followedKeys) {
      const metadata = metadataFor(pubkey);
      const name =
        metadata?.display_name || metadata?.name || genUserName(pubkey);

      const haystack = [name, metadata?.nip05, metadata?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (term && !haystack.includes(term)) continue;

      add({
        pubkey,
        name,
        picture: metadata?.picture,
        nip05: metadata?.nip05,
      });
    }

    for (const event of results?.profiles ?? []) {
      try {
        const metadata = n.json().pipe(n.metadata()).parse(event.content);
        add({
          pubkey: event.pubkey,
          name:
            metadata.display_name ||
            metadata.name ||
            genUserName(event.pubkey),
          picture: metadata.picture,
          nip05: metadata.nip05,
        });
      } catch {
        // A profile whose content is not metadata is not a person to message
      }
    }

    return list;
  }, [followedKeys, metadataFor, results, term, user?.pubkey]);

  /*
   * A pasted npub is its own answer. Somebody handed an identifier by another
   * app should not have to wait for a relay to agree that it names a person.
   */
  const pasted = useMemo(() => {
    const raw = query.trim();
    if (!raw.startsWith('npub1') && !raw.startsWith('nprofile1')) return null;

    try {
      const decoded = nip19.decode(raw);
      if (decoded.type === 'npub') return decoded.data;
      if (decoded.type === 'nprofile') return decoded.data.pubkey;
      return null;
    } catch {
      return null;
    }
  }, [query]);

  const openChat = (pubkey: string) => {
    onPick();
    navigate(`/chat/${nip19.npubEncode(pubkey)}`);
  };

  const empty = matches.length === 0 && !pasted;

  return (
    <>
      <div className="relative shrink-0 p-4">
        <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(field) => setQuery(field.target.value)}
          placeholder="Search people, or paste an npub"
          aria-label="Search people"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="pl-9"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))] scrollbar-thin">
        {pasted && (
          <PersonRow
            candidate={{ pubkey: pasted, name: genUserName(pasted) }}
            onSelect={openChat}
          />
        )}

        {matches.map((candidate) => (
          <PersonRow
            key={candidate.pubkey}
            candidate={candidate}
            onSelect={openChat}
          />
        ))}

        {empty && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {loadingFollows || isFetching
              ? 'Looking…'
              : term
                ? searchable
                  ? 'Nobody found. Try an npub, or another relay.'
                  : 'Keep typing to search beyond the people you follow.'
                : 'Follow someone, or paste their npub, to start a conversation.'}
          </p>
        )}
      </div>
    </>
  );
}

function PersonRow({
  candidate,
  onSelect,
}: {
  candidate: Candidate;
  onSelect: (pubkey: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(candidate.pubkey)}
      // 64px, like the conversation rows this sits over
      className="flex min-h-[64px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-accent lg:hover:bg-accent/60"
    >
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarImage src={candidate.picture} alt="" />
        <AvatarFallback className="text-xs">
          {candidate.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{candidate.name}</p>
        {candidate.nip05 && (
          <p className="truncate text-xs text-muted-foreground">
            {candidate.nip05}
          </p>
        )}
      </div>
    </button>
  );
}

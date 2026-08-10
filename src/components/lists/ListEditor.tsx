import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, UserPlus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuthor, type AuthorData } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useSaveList } from '@/hooks/useLists';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import {
  FOLLOW_SET_KIND,
  newListIdentifier,
  toPubkey,
  type PeopleList,
} from '@/lib/lists';

interface ListEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing list rather than starting one. */
  existing?: PeopleList;
  onSaved?: () => void;
}

interface Candidate {
  pubkey: string;
  name: string;
  picture?: string;
}

/**
 * Making a list.
 *
 * Two ways in, because people arrive with different things in hand: a pasted
 * npub from somewhere else, or a name they half remember from their own
 * follows. The second is the common case and is answered locally, from
 * profiles already loaded — a picker that waits on a relay to show you people
 * you already follow is a picker nobody uses twice.
 */
export function ListEditor({
  open,
  onOpenChange,
  existing,
  onSaved,
}: ListEditorProps) {
  const { user } = useCurrentUser();
  const { followingList } = useFollows(user?.pubkey || '');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { mutateAsync: save, isPending } = useSaveList();

  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [people, setPeople] = useState<string[]>(existing?.people ?? []);
  const [paste, setPaste] = useState('');
  const [search, setSearch] = useState('');

  /**
   * People to offer, from what the app already knows.
   *
   * Your follows first, then anyone whose profile has been loaded — which is
   * everyone whose posts you have scrolled past. Nothing is fetched: the point
   * of this picker is that it answers as fast as it can be typed into.
   */
  const candidates = useMemo(() => {
    if (!open) return [];

    // Type pinned rather than inferred: the follow list is loosely typed, and
    // a Set built from it would otherwise come out as Set<unknown>
    const following = new Set<string>(
      followingList.map((entry: { pubkey: string }) => entry.pubkey)
    );

    const cached = queryClient.getQueriesData<AuthorData>({
      queryKey: ['author'],
    });

    const found = new Map<string, Candidate>();

    for (const pubkey of following) {
      found.set(pubkey, { pubkey, name: genUserName(pubkey) });
    }

    for (const [key, data] of cached) {
      const pubkey = key[1];
      if (typeof pubkey !== 'string' || pubkey.length !== 64) continue;

      const metadata = data?.metadata;

      found.set(pubkey, {
        pubkey,
        name:
          metadata?.display_name || metadata?.name || genUserName(pubkey),
        picture: metadata?.picture,
      });
    }

    return [...found.values()].sort((a, b) => {
      const aFollows = following.has(a.pubkey);
      const bFollows = following.has(b.pubkey);
      if (aFollows !== bFollows) return aFollows ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [open, followingList, queryClient]);

  const query = search.trim().toLowerCase();

  const matches = useMemo(() => {
    const chosen = new Set(people);

    return candidates
      .filter((candidate) => !chosen.has(candidate.pubkey))
      .filter(
        (candidate) => !query || candidate.name.toLowerCase().includes(query)
      )
      .slice(0, 40);
  }, [candidates, query, people]);

  const add = (pubkey: string) => {
    setPeople((current) =>
      current.includes(pubkey) ? current : [...current, pubkey]
    );
  };

  const addPasted = () => {
    const pubkey = toPubkey(paste);

    if (!pubkey) {
      toast({
        title: 'Not a Nostr key',
        description: 'Paste an npub, an nprofile, or a 64-character hex key.',
        variant: 'destructive',
      });
      return;
    }

    add(pubkey);
    setPaste('');
  };

  const submit = async () => {
    // Kept when editing: the identifier is half the list's address, so a new
    // one would publish a second list rather than change this one
    const identifier = existing?.identifier ?? newListIdentifier(title);
    const kind = existing?.kind ?? FOLLOW_SET_KIND;

    await save({
      draft: {
        identifier,
        title,
        description,
        image: existing?.image,
        people,
      },
      kind,
    });

    onOpenChange(false);
    onSaved?.();

    // A new list opens on itself. Landing back on the index and hunting for
    // what you just made is a worse answer than being shown it
    if (!existing && user) {
      navigate(
        `/${nip19.naddrEncode({ kind, pubkey: user.pubkey, identifier })}`
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {existing ? 'Edit list' : 'New list'}
          </DialogTitle>
          <DialogDescription>
            Published to your relays as a NIP-51 follow set, so other Nostr
            clients can read it too.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="-mx-1 flex-1 px-1">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="list-title">Name</Label>
              <Input
                id="list-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Bitcoin devs, Photographers, People I trust…"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="list-description">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="list-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What these people have in common."
                rows={2}
              />
            </div>

            {people.length > 0 && (
              <div className="space-y-1.5">
                <Label>
                  In this list ({people.length})
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {people.map((pubkey) => (
                    <Chip
                      key={pubkey}
                      pubkey={pubkey}
                      onRemove={() =>
                        setPeople((current) =>
                          current.filter((entry) => entry !== pubkey)
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="list-paste">Add by npub</Label>
              <div className="flex gap-2">
                <Input
                  id="list-paste"
                  value={paste}
                  onChange={(event) => setPaste(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addPasted();
                    }
                  }}
                  placeholder="npub1…"
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={addPasted}
                  aria-label="Add this key"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="list-search">Or pick from people you know</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="list-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name"
                  className="pl-8"
                />
              </div>

              {matches.length > 0 ? (
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
                  {matches.map((candidate) => (
                    <button
                      key={candidate.pubkey}
                      type="button"
                      onClick={() => add(candidate.pubkey)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                    >
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarImage src={candidate.picture} alt="" />
                        <AvatarFallback className="text-[10px]">
                          {candidate.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {candidate.name}
                      </span>
                      <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {query
                    ? 'Nobody loaded matches that. Paste their npub above.'
                    : 'Scroll a feed first and the people in it turn up here.'}
                </p>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {people.length}{' '}
            {people.length === 1 ? 'person' : 'people'}
          </p>

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!title.trim() || isPending || !user}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {existing ? 'Save changes' : 'Create list'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Chip({
  pubkey,
  onRemove,
}: {
  pubkey: string;
  onRemove: () => void;
}) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.display_name || metadata?.name || genUserName(pubkey);

  return (
    <span className="flex items-center gap-1.5 rounded-full border bg-muted/50 py-0.5 pl-0.5 pr-1.5 text-xs">
      <Avatar className="h-5 w-5">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-[9px]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-28 truncate">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 hover:bg-background"
        aria-label={`Remove ${name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
